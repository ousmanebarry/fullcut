import 'server-only';
import type { Db } from '@/lib/shop/settings';
import { addMinutes, instantToIso, type Instant } from '@/lib/time';
import { parseInboundKind, type InboundKind } from './keywords';

export interface InboundSms {
	sid: string;
	from: string;
	body: string;
}

export interface InboundResult {
	kind: InboundKind;
	/** Shops the reply was recorded for (0 = no matching client or booking; dropped). */
	shops: number;
}

const RECENT_BOOKING_MINUTES = 30 * 24 * 60;

interface ClientMatch {
	id: string;
	shop_id: string;
}

/**
 * One Twilio sender serves every shop, and Twilio's own opt-out blocks the whole sender, so STOP and
 * START apply to the phone in every shop. YES confirms the phone's next booking; anything else goes to
 * the inbox of the shop with the nearest booking.
 */
export async function handleInbound(db: Db, sms: InboundSms, now: Instant): Promise<InboundResult> {
	const { data: clients, error } = await db
		.from('clients')
		.select('id, shop_id')
		.eq('phone_e164', sms.from)
		.is('anonymised_at', null);
	if (error) throw error;

	const parsed = parseInboundKind(sms.body);
	if (parsed === 'opt_out' || parsed === 'opt_in') {
		if (clients.length > 0) {
			const { error: updateError } = await db
				.from('clients')
				.update({ sms_opted_out: parsed === 'opt_out' })
				.in(
					'id',
					clients.map((c) => c.id),
				);
			if (updateError) throw updateError;
			await record(
				db,
				sms,
				clients.map((c) => ({ shopId: c.shop_id, clientId: c.id, bookingId: null })),
				parsed,
				now,
			);
		}
		return { kind: parsed, shops: clients.length };
	}

	if (parsed === 'confirm') {
		const next = await nextBooking(db, clients, now, ['confirmed']);
		if (next) {
			const { error: confirmError } = await db
				.from('bookings')
				.update({ client_confirmed_at: instantToIso(now) })
				.eq('shop_id', next.shop_id)
				.eq('id', next.id)
				.is('client_confirmed_at', null);
			if (confirmError) throw confirmError;
			await record(
				db,
				sms,
				[{ shopId: next.shop_id, clientId: next.client_id, bookingId: next.id }],
				'confirm',
				now,
			);
			return { kind: 'confirm', shops: 1 };
		}
	}

	const target =
		(await nextBooking(db, clients, now, ['confirmed', 'pending'])) ??
		(await recentBooking(db, clients, now));
	if (!target) return { kind: 'other', shops: 0 };
	await record(
		db,
		sms,
		[{ shopId: target.shop_id, clientId: target.client_id, bookingId: target.id }],
		'other',
		now,
	);
	return { kind: 'other', shops: 1 };
}

interface BookingRef {
	id: string;
	shop_id: string;
	client_id: string;
}

async function nextBooking(
	db: Db,
	clients: ClientMatch[],
	now: Instant,
	statuses: string[],
): Promise<BookingRef | null> {
	if (clients.length === 0) return null;
	const { data, error } = await db
		.from('bookings')
		.select('id, shop_id, client_id')
		.in(
			'client_id',
			clients.map((c) => c.id),
		)
		.in('status', statuses)
		.gt('starts_at', instantToIso(now))
		.order('starts_at')
		.limit(1)
		.maybeSingle();
	if (error) throw error;
	return data;
}

async function recentBooking(
	db: Db,
	clients: ClientMatch[],
	now: Instant,
): Promise<BookingRef | null> {
	if (clients.length === 0) return null;
	const { data, error } = await db
		.from('bookings')
		.select('id, shop_id, client_id')
		.in(
			'client_id',
			clients.map((c) => c.id),
		)
		.lte('starts_at', instantToIso(now))
		.gte('starts_at', instantToIso(addMinutes(now, -RECENT_BOOKING_MINUTES)))
		.order('starts_at', { ascending: false })
		.limit(1)
		.maybeSingle();
	if (error) throw error;
	return data;
}

async function record(
	db: Db,
	sms: InboundSms,
	targets: { shopId: string; clientId: string; bookingId: string | null }[],
	kind: InboundKind,
	now: Instant,
): Promise<void> {
	const { error } = await db.from('inbound_messages').upsert(
		targets.map((t) => ({
			shop_id: t.shopId,
			client_id: t.clientId,
			booking_id: t.bookingId,
			twilio_sid: sms.sid,
			from_phone: sms.from,
			body: sms.body.slice(0, 1600),
			kind,
			// Keyword replies are acted on automatically; only free text needs a person.
			handled_at: kind === 'other' ? null : instantToIso(now),
		})),
		{ onConflict: 'shop_id,twilio_sid', ignoreDuplicates: true },
	);
	if (error) throw error;
}
