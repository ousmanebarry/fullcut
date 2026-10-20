import 'server-only';
import type { Db } from '@/lib/shop/settings';
import { instantToIso, type Instant } from '@/lib/time';
import { TWILIO_UNSUBSCRIBED } from './sender';

// Callbacks can arrive out of order; a later stage never moves back to an earlier one.
const STAGE: Record<string, number> = {
	accepted: 0,
	queued: 1,
	sending: 2,
	sent: 3,
	delivered: 4,
	undelivered: 4,
	failed: 4,
	canceled: 4,
	read: 5,
};

export function isDeliveryStatus(value: string): boolean {
	return value in STAGE;
}

export function shouldApplyStatus(current: string | null, next: string): boolean {
	const nextStage = STAGE[next];
	if (nextStage === undefined) return false;
	const currentStage = current === null ? -1 : (STAGE[current] ?? -1);
	return nextStage > currentStage;
}

export interface StatusCallback {
	sid: string;
	status: string;
	errorCode: number | null;
}

/** Returns false when no message has that SID (or the update would move it backwards). */
export async function applyStatusCallback(
	db: Db,
	callback: StatusCallback,
	now: Instant,
): Promise<boolean> {
	const { data: message, error } = await db
		.from('scheduled_messages')
		.select('id, shop_id, client_id, delivery_status')
		.eq('twilio_sid', callback.sid)
		.maybeSingle();
	if (error) throw error;
	if (!message || !shouldApplyStatus(message.delivery_status, callback.status)) return false;

	const { error: updateError } = await db
		.from('scheduled_messages')
		.update({
			delivery_status: callback.status,
			...(callback.status === 'delivered' ? { delivered_at: instantToIso(now) } : {}),
			...(callback.errorCode !== null ? { error_code: callback.errorCode } : {}),
		})
		.eq('id', message.id);
	if (updateError) throw updateError;

	if (callback.errorCode === TWILIO_UNSUBSCRIBED) {
		const { error: optOutError } = await db
			.from('clients')
			.update({ sms_opted_out: true })
			.eq('shop_id', message.shop_id)
			.eq('id', message.client_id);
		if (optOutError) throw optOutError;
	}
	return true;
}
