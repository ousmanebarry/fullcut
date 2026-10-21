// The one send-time check every outgoing text goes through (docs/adr/0008-background-jobs-and-messaging.md).
import { isValidPhoneNumber } from 'libphonenumber-js/min';
import type { BookingStatus } from '@/lib/booking/types';
import {
	localDateOf,
	localMinuteOfDay,
	plusDays,
	zonedToInstant,
	type Instant,
	type TimeZone,
} from '@/lib/time';
import type { MessageType, SkipReason, WaitlistMessageType } from './types';

export const QUIET_HOURS_START_MINUTE = 21 * 60;
export const QUIET_HOURS_END_MINUTE = 9 * 60;

/** Sent straight after the client acts, so quiet hours do not apply. */
const QUIET_HOURS_EXEMPT: ReadonlySet<MessageType> = new Set(['confirmation']);

export interface SendContext {
	type: MessageType;
	shop: { timezone: TimeZone; isDemo: boolean; enabled: Readonly<Record<MessageType, boolean>> };
	client: { phoneE164: string | null; smsOptedOut: boolean };
	booking: { status: BookingStatus; startsAt: Instant };
}

export type SendDecision =
	{ action: 'send' } | { action: 'skip'; reason: SkipReason } | { action: 'defer'; until: Instant };

/** End of the quiet period containing `now` (09:00 shop time), or null outside quiet hours. */
export function quietHoursEnd(now: Instant, zone: TimeZone): Instant | null {
	const minute = localMinuteOfDay(now, zone);
	const today = localDateOf(now, zone);
	if (minute < QUIET_HOURS_END_MINUTE) return zonedToInstant(today, QUIET_HOURS_END_MINUTE, zone);
	if (minute >= QUIET_HOURS_START_MINUTE) {
		return zonedToInstant(plusDays(today, 1), QUIET_HOURS_END_MINUTE, zone);
	}
	return null;
}

const skip = (reason: SkipReason): SendDecision => ({ action: 'skip', reason });

export interface WaitlistSendContext {
	type: WaitlistMessageType;
	shop: { timezone: TimeZone; isDemo: boolean; waitlistEnabled: boolean };
	client: { phoneE164: string | null; smsOptedOut: boolean };
	entry: { active: boolean };
	/** Offer texts only: whether the offer is still open (sent and unexpired). */
	offer?: { open: boolean };
}

/**
 * Send-time check for waitlist texts. The join confirmation answers a client action, so quiet hours
 * don't apply; an offer is never sent in quiet hours and never deferred (the next wave takes over).
 */
export function decideWaitlistSend(ctx: WaitlistSendContext, now: Instant): SendDecision {
	const { shop, client, entry } = ctx;
	if (shop.isDemo) return skip('demo_shop');
	if (!shop.waitlistEnabled) return skip('type_disabled');
	if (client.smsOptedOut) return skip('opted_out');
	if (!client.phoneE164) return skip('no_phone');
	if (!isValidPhoneNumber(client.phoneE164)) return skip('invalid_phone');
	if (!entry.active) return skip('entry_inactive');
	if (ctx.type === 'waitlist_offer') {
		if (!ctx.offer?.open) return skip('offer_closed');
		if (quietHoursEnd(now, shop.timezone) !== null) return skip('quiet_hours');
	}
	return { action: 'send' };
}

export function decideSend(ctx: SendContext, now: Instant): SendDecision {
	const { type, shop, client, booking } = ctx;
	if (shop.isDemo) return skip('demo_shop');
	if (!shop.enabled[type]) return skip('type_disabled');
	if (client.smsOptedOut) return skip('opted_out');
	if (!client.phoneE164) return skip('no_phone');
	if (!isValidPhoneNumber(client.phoneE164)) return skip('invalid_phone');

	const expectedStatus: BookingStatus = type === 'cancelled' ? 'cancelled' : 'confirmed';
	if (booking.status !== expectedStatus) return skip('booking_inactive');
	if (now >= booking.startsAt) return skip('too_late');

	if (QUIET_HOURS_EXEMPT.has(type)) return { action: 'send' };
	const until = quietHoursEnd(now, shop.timezone);
	if (until === null) return { action: 'send' };
	return until >= booking.startsAt ? skip('too_late') : { action: 'defer', until };
}
