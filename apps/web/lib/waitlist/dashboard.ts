// Dashboard reads and writes for the waitlist. Callers pass a user-scoped client (RLS applies) and the
// session's shop; every query is also filtered by shop_id.
import type { Result } from '@/lib/booking/types';
import { countryForCurrency, normalizePhone } from '@/lib/contact/phone';
import type { Actor, Db } from '@/lib/shop/settings';
import {
	daysBetween,
	formatShortDate,
	formatSlotLabel,
	instantFromIso,
	localDate,
	localDateOf,
	plusDays,
	zonedToInstant,
	type Instant,
	type TimeZone,
} from '@/lib/time';
import type { StaffEntryInput } from './staff-schema';
import { buildWindows, describeWindows, parseWindows } from './types';

export interface WaitlistEntryRow {
	id: string;
	clientId: string;
	clientName: string;
	clientPhone: string | null;
	serviceName: string;
	staffName: string | null;
	datesLabel: string;
	windowsLabel: string;
	ageLabel: string;
	requestMethod: 'booking_page' | 'staff';
}

export type OfferStatus = 'sent' | 'claimed' | 'taken' | 'expired' | 'withdrawn';

export interface WaitlistOfferRow {
	id: string;
	clientName: string;
	serviceName: string;
	staffName: string;
	slotLabel: string;
	sentLabel: string;
	wave: number;
	status: OfferStatus;
	bookingId: string | null;
}

export const OFFER_STATUS_LABELS: Record<OfferStatus, string> = {
	sent: 'Waiting',
	claimed: 'Booked',
	taken: 'Someone else booked',
	expired: 'No reply',
	withdrawn: 'Slot filled another way',
};

function dateLabel(date: string, zone: TimeZone): string {
	// Noon avoids DST edge cases when formatting a plain date.
	return formatShortDate(zonedToInstant(localDate(date), 12 * 60, zone), zone);
}

function ageLabel(createdAt: Instant, now: Instant): string {
	const minutes = Math.max(0, Math.round((now - createdAt) / 60_000));
	if (minutes < 60) return `${minutes} min`;
	if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h`;
	return `${Math.round(minutes / (24 * 60))} d`;
}

export async function listActiveEntries(
	db: Db,
	shopId: string,
	zone: TimeZone,
	now: Instant,
): Promise<WaitlistEntryRow[]> {
	const { data, error } = await db
		.from('waitlist_entries')
		.select(
			'id, client_id, earliest_date, latest_date, time_windows, request_method, created_at, client:clients!waitlist_entries_client_same_shop_fk(name, phone_e164), service:services!waitlist_entries_service_same_shop_fk(name), staff:staff!waitlist_entries_staff_same_shop_fk(display_name)',
		)
		.eq('shop_id', shopId)
		.eq('status', 'active')
		.order('created_at');
	if (error) throw error;
	return data.map((e) => ({
		id: e.id,
		clientId: e.client_id,
		clientName: e.client.name,
		clientPhone: e.client.phone_e164,
		serviceName: e.service.name,
		staffName: e.staff?.display_name ?? null,
		datesLabel: `${dateLabel(e.earliest_date, zone)} – ${dateLabel(e.latest_date, zone)}`,
		windowsLabel: describeWindows(parseWindows(e.time_windows)),
		ageLabel: ageLabel(instantFromIso(e.created_at), now),
		requestMethod: e.request_method === 'staff' ? 'staff' : 'booking_page',
	}));
}

export const RECENT_OFFERS_LIMIT = 30;

export async function listRecentOffers(
	db: Db,
	shopId: string,
	zone: TimeZone,
): Promise<WaitlistOfferRow[]> {
	const { data, error } = await db
		.from('slot_offers')
		.select(
			'id, starts_at, sent_at, wave, status, booking_id, entry:waitlist_entries!slot_offers_entry_same_shop_fk(client:clients!waitlist_entries_client_same_shop_fk(name)), service:services!slot_offers_service_same_shop_fk(name), staff:staff!slot_offers_staff_same_shop_fk(display_name)',
		)
		.eq('shop_id', shopId)
		.order('sent_at', { ascending: false })
		.limit(RECENT_OFFERS_LIMIT);
	if (error) throw error;
	return data.map((o) => ({
		id: o.id,
		clientName: o.entry.client.name,
		serviceName: o.service.name,
		staffName: o.staff.display_name,
		slotLabel: formatSlotLabel(instantFromIso(o.starts_at), zone),
		sentLabel: formatSlotLabel(instantFromIso(o.sent_at), zone),
		wave: o.wave,
		status: o.status as OfferStatus,
		bookingId: o.booking_id,
	}));
}

export type EntryMutationResult = Result<null, { message: string; field?: string }>;

const failure = (message: string, field?: string): EntryMutationResult => ({
	ok: false,
	error: { message, field },
});

/** Adds a client who asked (e.g. by phone) to be texted when a spot opens. */
export async function addEntryForClient(
	db: Db,
	actor: Actor,
	shop: { currency: string; timezone: TimeZone; maxHorizonDays: number },
	input: StaffEntryInput,
	now: Instant,
): Promise<EntryMutationResult> {
	const phone = normalizePhone(input.phone, countryForCurrency(shop.currency));
	if (!phone) return failure('Enter a valid mobile number.', 'phone');
	const today = localDateOf(now, shop.timezone);
	if (daysBetween(today, input.earliestDate) < 0) {
		return failure('Choose a date from today onwards.', 'earliestDate');
	}
	if (daysBetween(plusDays(today, shop.maxHorizonDays), input.latestDate) > 0) {
		return failure(`Choose a date within the next ${shop.maxHorizonDays} days.`, 'latestDate');
	}

	const { error } = await db.rpc('add_waitlist_entry', {
		p_shop_id: actor.shopId,
		p_service_id: input.serviceId,
		p_staff_id: input.staffId === 'any' ? undefined : input.staffId,
		p_earliest_date: input.earliestDate,
		p_latest_date: input.latestDate,
		p_time_windows: buildWindows(input.weekdays, input.times),
		p_client_name: input.name,
		p_phone_e164: phone,
	});
	if (!error) return { ok: true, value: null };
	switch (error.code) {
		case 'FC002':
			return failure('This client is already on the waitlist 3 times. Cancel an entry first.');
		case 'FC003':
			return failure('Turn the waitlist on in Settings first.');
		case 'FC004':
			return failure('This client replied STOP, so we cannot text them.');
		case '23503':
		case 'P0002':
			return failure('That service or stylist no longer exists.');
		default:
			throw error;
	}
}

/** Any member may take a client off the waitlist; open offers are withdrawn by the database. */
export async function cancelEntry(
	db: Db,
	actor: Actor,
	entryId: string,
): Promise<EntryMutationResult> {
	const { data, error } = await db
		.from('waitlist_entries')
		.update({ status: 'cancelled' })
		.eq('shop_id', actor.shopId)
		.eq('id', entryId)
		.eq('status', 'active')
		.select('id');
	if (error) throw error;
	return data.length === 1 ? { ok: true, value: null } : failure('That entry is no longer active.');
}
