import type { Result } from '@/lib/booking/types';
import { lastBookableDate, staffIdsFor } from '@/lib/public-booking/availability';
import { loadActiveServices, loadActiveStaff, type BookingShop } from '@/lib/public-booking/data';
import type { Db } from '@/lib/shop/settings';
import { daysBetween, localDateOf, type Instant } from '@/lib/time';
import type { WaitlistBody } from './schemas';

export type WaitlistFailure =
	| { kind: 'invalid'; fieldErrors: Record<string, string> }
	| { kind: 'not_found' }
	| { kind: 'disabled' }
	| { kind: 'too_many' }
	| { kind: 'opted_out' };

export interface WaitlistJoinInput extends Omit<WaitlistBody, 'website' | 'offersRequested'> {
	phoneE164: string;
}

/** Adds the client to the shop's waitlist; the database enforces the per-phone entry cap. */
export async function joinWaitlist(
	db: Db,
	shop: BookingShop,
	input: WaitlistJoinInput,
	now: Instant,
): Promise<Result<{ entryId: string }, WaitlistFailure>> {
	if (!shop.waitlistEnabled) return fail({ kind: 'disabled' });

	const today = localDateOf(now, shop.timezone);
	const fieldErrors: Record<string, string> = {};
	if (daysBetween(today, input.earliestDate) < 0) {
		fieldErrors.earliestDate = 'Choose a date from today onwards.';
	}
	if (daysBetween(lastBookableDate(shop, now), input.latestDate) > 0) {
		fieldErrors.latestDate = `Choose a date within the next ${shop.settings.maxHorizonDays} days.`;
	}
	if (Object.keys(fieldErrors).length > 0) return fail({ kind: 'invalid', fieldErrors });

	const [services, staff] = await Promise.all([
		loadActiveServices(db, shop.id),
		loadActiveStaff(db, shop.id),
	]);
	const staffIds = staffIdsFor(input.staffId, staff);
	if (!services.some((s) => s.id === input.serviceId) || !staffIds)
		return fail({ kind: 'not_found' });

	const { data, error } = await db.rpc('join_waitlist', {
		p_shop_id: shop.id,
		p_service_id: input.serviceId,
		// 'any' is stored as no staff preference.
		p_staff_id: input.staffId === 'any' ? undefined : input.staffId,
		p_earliest_date: input.earliestDate,
		p_latest_date: input.latestDate,
		p_time_windows: input.timeWindows,
		p_client_name: input.name,
		p_phone_e164: input.phoneE164,
	});
	if (!error) return { ok: true, value: { entryId: data } };

	switch (error.code) {
		case 'FC002':
			return fail({ kind: 'too_many' });
		case 'FC003':
			return fail({ kind: 'disabled' });
		case 'FC004':
			return fail({ kind: 'opted_out' });
		case '23503':
		case 'P0002':
			return fail({ kind: 'not_found' });
		default:
			throw error;
	}
}

function fail(error: WaitlistFailure): Result<never, WaitlistFailure> {
	return { ok: false, error };
}
