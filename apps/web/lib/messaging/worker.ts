import 'server-only';
import type { BookingStatus } from '@/lib/booking/types';
import type { Database } from '@/lib/database.types';
import { hashToken, issueToken, linkExpiry, manageUrl } from '@/lib/public-booking/links';
import type { Db } from '@/lib/shop/settings';
import { addMinutes, instantFromIso, instantToIso, timeZone, type Instant } from '@/lib/time';
import { decideSend, type SendContext } from './rules';
import { TWILIO_UNSUBSCRIBED, type MessageSender } from './sender';
import {
	MANAGE_LINK_PLACEHOLDER,
	needsManageLink,
	renderMessage,
	type TemplateInput,
} from './templates';
import { isMessageType, type MessageType } from './types';

type MessageRow = Database['public']['Tables']['scheduled_messages']['Row'];
type MessagePatch = Database['public']['Tables']['scheduled_messages']['Update'];

export const MAX_ATTEMPTS = 3;
export const CLAIM_BATCH = 10;
const RETRY_DELAY_MINUTES = [1, 5, 25];

export interface WorkerOptions {
	sender: MessageSender;
	siteUrl: string;
	statusCallbackUrl: string | null;
	clock?: () => Instant;
	/** Stop claiming new batches after this long. */
	budgetMs?: number;
}

type Outcome = 'sent' | 'skipped' | 'deferred' | 'retried' | 'failed';
export type BatchCounts = Record<Outcome, number>;

const BOOKING_CONTEXT = `status, starts_at, client_id,
	client:clients!bookings_client_same_shop_fk(phone_e164, sms_opted_out),
	service:services!bookings_service_same_shop_fk(name),
	staff:staff!bookings_staff_same_shop_fk(display_name),
	shop:shops!bookings_shop_id_fkey(name, timezone, sms_sign_off, sms_confirmation_enabled,
		sms_reminder_enabled, sms_confirm_request_enabled, sms_rescheduled_enabled, sms_cancelled_enabled)`;

interface LoadedContext {
	send: SendContext;
	template: Omit<TemplateInput, 'manageUrl'>;
	clientId: string;
}

/** Claims due messages in small batches and sends them until none are due or the budget runs out. */
export async function runMessageBatch(db: Db, options: WorkerOptions): Promise<BatchCounts> {
	const clock = options.clock ?? (() => Date.now() as Instant);
	const deadline = clock() + (options.budgetMs ?? 20_000);
	const counts: BatchCounts = { sent: 0, skipped: 0, deferred: 0, retried: 0, failed: 0 };
	const demoShops = new Map<string, boolean>();

	for (;;) {
		const { data, error } = await db.rpc('claim_due_messages', { p_limit: CLAIM_BATCH });
		if (error) throw error;
		for (const row of data) {
			counts[await processMessage(db, row, options, clock(), demoShops)]++;
		}
		if (data.length < CLAIM_BATCH || clock() >= deadline) return counts;
	}
}

async function processMessage(
	db: Db,
	row: MessageRow,
	options: WorkerOptions,
	now: Instant,
	demoShops: Map<string, boolean>,
): Promise<Outcome> {
	const release = async (patch: MessagePatch) => {
		const { error } = await db
			.from('scheduled_messages')
			.update({ ...patch, locked_at: null })
			.eq('id', row.id)
			.eq('status', 'sending');
		if (error) throw error;
	};

	let attemptedSend = false;
	try {
		if (!isMessageType(row.type)) {
			await release({ status: 'failed', last_error: 'unknown_type' });
			return 'failed';
		}
		const ctx = await loadContext(db, row, row.type, demoShops);
		if (!ctx) {
			await release({ status: 'skipped', skip_reason: 'booking_inactive' });
			return 'skipped';
		}

		const decision = decideSend(ctx.send, now);
		if (decision.action === 'skip') {
			await release({ status: 'skipped', skip_reason: decision.reason });
			return 'skipped';
		}
		if (decision.action === 'defer') {
			// Waiting out quiet hours is not a failed attempt.
			await release({
				status: 'queued',
				send_at: instantToIso(decision.until),
				attempts: Math.max(0, row.attempts - 1),
			});
			return 'deferred';
		}

		const link = needsManageLink(row.type)
			? await issueManageLink(db, row, ctx.send.booking.startsAt, options.siteUrl)
			: null;
		const input: TemplateInput = { ...ctx.template, manageUrl: link };
		const stored = renderMessage(row.type, {
			...input,
			manageUrl: link ? MANAGE_LINK_PLACEHOLDER : null,
		});

		attemptedSend = true;
		const result = await options.sender.send({
			// decideSend guarantees a phone number.
			to: ctx.send.client.phoneE164 ?? '',
			body: renderMessage(row.type, input),
			statusCallback: options.statusCallbackUrl,
		});

		if (result.ok) {
			await release({
				status: 'sent',
				sent_at: instantToIso(now),
				twilio_sid: result.sid,
				delivery_status: result.deliveryStatus,
				body: stored,
				last_error: null,
				error_code: null,
			});
			return 'sent';
		}

		if (result.code === TWILIO_UNSUBSCRIBED) {
			const { error } = await db
				.from('clients')
				.update({ sms_opted_out: true })
				.eq('shop_id', row.shop_id)
				.eq('id', ctx.clientId);
			if (error) throw error;
		}
		const failure = { last_error: result.message, error_code: result.code, body: stored };
		if (result.retryable && row.attempts < MAX_ATTEMPTS) {
			const delay = RETRY_DELAY_MINUTES[row.attempts - 1] ?? 25;
			await release({
				...failure,
				status: 'queued',
				send_at: instantToIso(addMinutes(now, delay)),
			});
			return 'retried';
		}
		await release({ ...failure, status: 'failed' });
		return 'failed';
	} catch (error) {
		console.error('[messaging] message %s failed: %o', row.id, error);
		// After a send attempt the outcome is unknown: the row stays 'sending' and is failed later, never resent.
		if (!attemptedSend) {
			await release({
				status: row.attempts < MAX_ATTEMPTS ? 'queued' : 'failed',
				send_at: instantToIso(addMinutes(now, RETRY_DELAY_MINUTES[row.attempts - 1] ?? 25)),
				last_error: 'internal_error',
			}).catch(() => undefined);
		}
		return 'failed';
	}
}

async function loadContext(
	db: Db,
	row: MessageRow,
	type: MessageType,
	demoShops: Map<string, boolean>,
): Promise<LoadedContext | null> {
	const { data, error } = await db
		.from('bookings')
		.select(BOOKING_CONTEXT)
		.eq('shop_id', row.shop_id)
		.eq('id', row.booking_id)
		.maybeSingle();
	if (error) throw error;
	if (!data) return null;

	let isDemo = demoShops.get(row.shop_id);
	if (isDemo === undefined) {
		const demo = await db.rpc('is_demo_shop', { p_shop_id: row.shop_id });
		if (demo.error) throw demo.error;
		isDemo = demo.data;
		demoShops.set(row.shop_id, isDemo);
	}

	const { shop } = data;
	const zone = timeZone(shop.timezone);
	const startsAt = instantFromIso(data.starts_at);
	return {
		clientId: data.client_id,
		send: {
			type,
			shop: {
				timezone: zone,
				isDemo,
				enabled: {
					confirmation: shop.sms_confirmation_enabled,
					reminder: shop.sms_reminder_enabled,
					confirm_request: shop.sms_confirm_request_enabled,
					rescheduled: shop.sms_rescheduled_enabled,
					cancelled: shop.sms_cancelled_enabled,
				},
			},
			client: { phoneE164: data.client.phone_e164, smsOptedOut: data.client.sms_opted_out },
			booking: { status: data.status as BookingStatus, startsAt },
		},
		template: {
			shopName: shop.name,
			serviceName: data.service.name,
			staffName: data.staff.display_name,
			startsAt,
			timezone: zone,
			signOff: shop.sms_sign_off,
		},
	};
}

/** Manage tokens are only stored hashed, so each text gets a fresh link of its own. */
async function issueManageLink(
	db: Db,
	row: MessageRow,
	startsAt: Instant,
	siteUrl: string,
): Promise<string> {
	const token = issueToken();
	const { error } = await db.from('booking_links').insert({
		shop_id: row.shop_id,
		booking_id: row.booking_id,
		token_hash: hashToken(token),
		expires_at: instantToIso(linkExpiry(startsAt)),
	});
	if (error) throw error;
	return manageUrl(siteUrl, token);
}
