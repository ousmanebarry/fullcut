import 'server-only';
import type { BookingStatus } from '@/lib/booking/types';
import type { Database } from '@/lib/database.types';
import { hashToken, issueToken, linkExpiry, manageUrl } from '@/lib/public-booking/links';
import type { Db } from '@/lib/shop/settings';
import {
	addMinutes,
	instantFromIso,
	instantToIso,
	localDate,
	timeZone,
	type Instant,
} from '@/lib/time';
import { claimUrl, waitlistLinkExpiry, waitlistUrl } from '@/lib/waitlist/links';
import { decideSend, decideWaitlistSend, type SendContext } from './rules';
import { TWILIO_UNSUBSCRIBED, type MessageSender } from './sender';
import {
	CLAIM_LINK_PLACEHOLDER,
	MANAGE_LINK_PLACEHOLDER,
	WAITLIST_LINK_PLACEHOLDER,
	needsManageLink,
	renderMessage,
	renderWaitlistJoined,
	renderWaitlistOffer,
	type TemplateInput,
} from './templates';
import {
	isMessageType,
	isWaitlistMessageType,
	type MessageType,
	type SkipReason,
	type WaitlistMessageType,
} from './types';

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

const ENTRY_CONTEXT = `status, client_id, latest_date,
	client:clients!waitlist_entries_client_same_shop_fk(phone_e164, sms_opted_out),
	service:services!waitlist_entries_service_same_shop_fk(name),
	shop:shops!waitlist_entries_shop_id_fkey(name, timezone, sms_sign_off, waitlist_enabled)`;

const OFFER_CONTEXT = `status, starts_at, expires_at, token_hash,
	entry:waitlist_entries!slot_offers_entry_same_shop_fk(status, client_id,
		client:clients!waitlist_entries_client_same_shop_fk(phone_e164, sms_opted_out)),
	service:services!slot_offers_service_same_shop_fk(name),
	staff:staff!slot_offers_staff_same_shop_fk(display_name),
	shop:shops!slot_offers_shop_id_fkey(name, timezone, sms_sign_off, waitlist_enabled)`;

interface LoadedContext {
	send: SendContext;
	template: Omit<TemplateInput, 'manageUrl'>;
	clientId: string;
}

/** What to do with a claimed row once its subject (booking, waitlist entry) has been looked at. */
type Prepared =
	| { action: 'fail'; error: string }
	| { action: 'skip'; reason: SkipReason }
	| { action: 'defer'; until: Instant }
	| { action: 'send'; to: string; body: string; stored: string; clientId: string };

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
		const prepared = await prepare(db, row, options, now, demoShops);
		if (prepared.action === 'fail') {
			await release({ status: 'failed', last_error: prepared.error });
			return 'failed';
		}
		if (prepared.action === 'skip') {
			await release({ status: 'skipped', skip_reason: prepared.reason });
			return 'skipped';
		}
		if (prepared.action === 'defer') {
			// Waiting out quiet hours is not a failed attempt.
			await release({
				status: 'queued',
				send_at: instantToIso(prepared.until),
				attempts: Math.max(0, row.attempts - 1),
			});
			return 'deferred';
		}

		attemptedSend = true;
		const result = await options.sender.send({
			to: prepared.to,
			body: prepared.body,
			statusCallback: options.statusCallbackUrl,
		});

		if (result.ok) {
			await release({
				status: 'sent',
				sent_at: instantToIso(now),
				twilio_sid: result.sid,
				delivery_status: result.deliveryStatus,
				body: prepared.stored,
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
				.eq('id', prepared.clientId);
			if (error) throw error;
		}
		const failure = { last_error: result.message, error_code: result.code, body: prepared.stored };
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

async function prepare(
	db: Db,
	row: MessageRow,
	options: WorkerOptions,
	now: Instant,
	demoShops: Map<string, boolean>,
): Promise<Prepared> {
	if (isWaitlistMessageType(row.type)) {
		return prepareWaitlist(db, row, row.type, options, now, demoShops);
	}
	if (!isMessageType(row.type) || !row.booking_id) return { action: 'fail', error: 'unknown_type' };
	return prepareBooking(db, row, row.booking_id, row.type, options, now, demoShops);
}

async function prepareBooking(
	db: Db,
	row: MessageRow,
	bookingId: string,
	type: MessageType,
	options: WorkerOptions,
	now: Instant,
	demoShops: Map<string, boolean>,
): Promise<Prepared> {
	const ctx = await loadContext(db, row, bookingId, type, demoShops);
	if (!ctx) return { action: 'skip', reason: 'booking_inactive' };

	const decision = decideSend(ctx.send, now);
	if (decision.action !== 'send') return decision;

	const link = needsManageLink(type)
		? await issueManageLink(db, row, bookingId, ctx.send.booking.startsAt, options.siteUrl)
		: null;
	const input: TemplateInput = { ...ctx.template, manageUrl: link };
	return {
		action: 'send',
		// decideSend guarantees a phone number.
		to: ctx.send.client.phoneE164 ?? '',
		body: renderMessage(type, input),
		stored: renderMessage(type, {
			...input,
			manageUrl: link ? MANAGE_LINK_PLACEHOLDER : null,
		}),
		clientId: ctx.clientId,
	};
}

async function prepareWaitlist(
	db: Db,
	row: MessageRow,
	type: WaitlistMessageType,
	options: WorkerOptions,
	now: Instant,
	demoShops: Map<string, boolean>,
): Promise<Prepared> {
	if (type === 'waitlist_offer') return prepareOffer(db, row, options, now, demoShops);
	if (!row.waitlist_entry_id) return { action: 'fail', error: 'unknown_type' };
	const { data, error } = await db
		.from('waitlist_entries')
		.select(ENTRY_CONTEXT)
		.eq('shop_id', row.shop_id)
		.eq('id', row.waitlist_entry_id)
		.maybeSingle();
	if (error) throw error;
	if (!data) return { action: 'skip', reason: 'entry_inactive' };

	const { shop, client } = data;
	const zone = timeZone(shop.timezone);
	const decision = decideWaitlistSend(
		{
			type,
			shop: {
				timezone: zone,
				isDemo: await isDemoShop(db, row.shop_id, demoShops),
				waitlistEnabled: shop.waitlist_enabled,
			},
			client: { phoneE164: client.phone_e164, smsOptedOut: client.sms_opted_out },
			entry: { active: data.status === 'active' },
		},
		now,
	);
	if (decision.action !== 'send') return decision;

	const token = issueToken();
	const { error: linkError } = await db.from('waitlist_links').insert({
		shop_id: row.shop_id,
		waitlist_entry_id: row.waitlist_entry_id,
		token_hash: hashToken(token),
		expires_at: instantToIso(waitlistLinkExpiry(localDate(data.latest_date), zone)),
	});
	if (linkError) throw linkError;

	const text = { shopName: shop.name, serviceName: data.service.name, signOff: shop.sms_sign_off };
	return {
		action: 'send',
		// decideWaitlistSend guarantees a phone number.
		to: client.phone_e164 ?? '',
		body: renderWaitlistJoined({ ...text, waitlistUrl: waitlistUrl(options.siteUrl, token) }),
		stored: renderWaitlistJoined({ ...text, waitlistUrl: WAITLIST_LINK_PLACEHOLDER }),
		clientId: data.client_id,
	};
}

async function prepareOffer(
	db: Db,
	row: MessageRow,
	options: WorkerOptions,
	now: Instant,
	demoShops: Map<string, boolean>,
): Promise<Prepared> {
	if (!row.slot_offer_id) return { action: 'fail', error: 'unknown_type' };
	const { data, error } = await db
		.from('slot_offers')
		.select(OFFER_CONTEXT)
		.eq('shop_id', row.shop_id)
		.eq('id', row.slot_offer_id)
		.maybeSingle();
	if (error) throw error;
	if (!data) return { action: 'skip', reason: 'offer_closed' };

	const { shop, entry } = data;
	const zone = timeZone(shop.timezone);
	const expiresAt = instantFromIso(data.expires_at);
	const decision = decideWaitlistSend(
		{
			type: 'waitlist_offer',
			shop: {
				timezone: zone,
				isDemo: await isDemoShop(db, row.shop_id, demoShops),
				waitlistEnabled: shop.waitlist_enabled,
			},
			client: { phoneE164: entry.client.phone_e164, smsOptedOut: entry.client.sms_opted_out },
			entry: { active: entry.status === 'active' },
			offer: { open: data.status === 'sent' && now < expiresAt && data.token_hash === null },
		},
		now,
	);
	if (decision.action !== 'send') return decision;

	// One token per offer; the guard makes sure a second worker can never issue another.
	const token = issueToken();
	const issued = await db
		.from('slot_offers')
		.update({ token_hash: hashToken(token) })
		.eq('id', row.slot_offer_id)
		.is('token_hash', null)
		.select('id');
	if (issued.error) throw issued.error;
	if (issued.data.length === 0) return { action: 'skip', reason: 'offer_closed' };

	const text = {
		shopName: shop.name,
		serviceName: data.service.name,
		staffName: data.staff.display_name,
		startsAt: instantFromIso(data.starts_at),
		expiresAt,
		timezone: zone,
		signOff: shop.sms_sign_off,
	};
	return {
		action: 'send',
		// decideWaitlistSend guarantees a phone number.
		to: entry.client.phone_e164 ?? '',
		body: renderWaitlistOffer({ ...text, claimUrl: claimUrl(options.siteUrl, token) }),
		stored: renderWaitlistOffer({ ...text, claimUrl: CLAIM_LINK_PLACEHOLDER }),
		clientId: entry.client_id,
	};
}

async function isDemoShop(
	db: Db,
	shopId: string,
	demoShops: Map<string, boolean>,
): Promise<boolean> {
	let isDemo = demoShops.get(shopId);
	if (isDemo === undefined) {
		const demo = await db.rpc('is_demo_shop', { p_shop_id: shopId });
		if (demo.error) throw demo.error;
		isDemo = demo.data;
		demoShops.set(shopId, isDemo);
	}
	return isDemo;
}

async function loadContext(
	db: Db,
	row: MessageRow,
	bookingId: string,
	type: MessageType,
	demoShops: Map<string, boolean>,
): Promise<LoadedContext | null> {
	const { data, error } = await db
		.from('bookings')
		.select(BOOKING_CONTEXT)
		.eq('shop_id', row.shop_id)
		.eq('id', bookingId)
		.maybeSingle();
	if (error) throw error;
	if (!data) return null;

	const isDemo = await isDemoShop(db, row.shop_id, demoShops);

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
	bookingId: string,
	startsAt: Instant,
	siteUrl: string,
): Promise<string> {
	const token = issueToken();
	const { error } = await db.from('booking_links').insert({
		shop_id: row.shop_id,
		booking_id: bookingId,
		token_hash: hashToken(token),
		expires_at: instantToIso(linkExpiry(startsAt)),
	});
	if (error) throw error;
	return manageUrl(siteUrl, token);
}
