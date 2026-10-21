// Dashboard reads. Callers pass a user-scoped client (RLS applies) and the shop derived on the server.
import { generateSlots } from '@/lib/booking/generate-slots';
import type {
	AvailabilityRule,
	BookingStatus,
	ShopSchedulingSettings,
	TimeOff,
} from '@/lib/booking/types';
import { clientSearchPattern } from '@/lib/clients/search';
import type { Json } from '@/lib/database.types';
import { isConfirmationStatus, isRiskTier, type BookingRisk } from '@/lib/risk/types';
import { dateWindow, nearestSlots } from '@/lib/public-booking/availability';
import {
	loadSchedulingContext,
	type BookableService,
	type BookingShop,
	type SchedulingWindow,
} from '@/lib/public-booking/data';
import type { Db } from '@/lib/shop/settings';
import {
	addMinutes,
	formatLocalTime,
	formatSlotLabel,
	instantFromIso,
	instantToIso,
	localDateOf,
	localDateParts,
	localMinuteOfDay,
	localTime,
	plusDays,
	zonedToInstant,
	type Instant,
	type LocalDate,
	type TimeZone,
} from '@/lib/time';
import type { ClientMatch, DashboardBooking, DashboardSlot } from './types';

export const BOOKING_COLUMNS =
	'id, status, source, starts_at, ends_at, blocked_until, price_cents, client_notes, cancel_reason, outcome_marked_at, created_at, staff_id, service_id, client_id, risk_score, risk_tier, risk_method, risk_factors, risk_trusted_at, confirmation_status, confirmation_due_at, client:clients!bookings_client_same_shop_fk(name, phone_e164), service:services!bookings_service_same_shop_fk(name), staff:staff!bookings_staff_same_shop_fk(display_name)';

// Lower bound for range queries so (shop_id, starts_at) stays index-bounded; no service runs this long.
const MAX_BOOKING_SPAN_MINUTES = 12 * 60;
const UNMARKED_LIMIT = 200;

/** Staff can book outside the public lead time and horizon. */
export function staffSettings(shop: BookingShop): ShopSchedulingSettings {
	return { ...shop.settings, minLeadMinutes: 0, maxHorizonDays: 3650 };
}

export function dayWindow(date: LocalDate, zone: TimeZone, days = 1): SchedulingWindow {
	return dateWindow(date, plusDays(date, days - 1), zone);
}

export function hhmm(instant: Instant, zone: TimeZone): string {
	const minute = localMinuteOfDay(instant, zone);
	return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

export function toDashboardSlot(startsAt: Instant, zone: TimeZone): DashboardSlot {
	return { time: hhmm(startsAt, zone), label: formatLocalTime(startsAt, zone) };
}

export function dateLabel(date: LocalDate): string {
	const parts = localDateParts(date);
	return `${parts.weekday}, ${parts.month} ${parts.day}`;
}

type BookingRow = {
	id: string;
	status: string;
	source: string;
	starts_at: string;
	ends_at: string;
	blocked_until: string;
	price_cents: number;
	client_notes: string | null;
	cancel_reason: string | null;
	outcome_marked_at: string | null;
	created_at: string;
	staff_id: string;
	service_id: string;
	client_id: string;
	risk_score: number | null;
	risk_tier: string | null;
	risk_method: string | null;
	risk_factors: Json | null;
	risk_trusted_at: string | null;
	confirmation_status: string;
	confirmation_due_at: string | null;
	client: { name: string; phone_e164: string | null };
	service: { name: string };
	staff: { display_name: string };
};

function toBookingRisk(row: BookingRow): BookingRisk | null {
	if (!isRiskTier(row.risk_tier)) return null;
	return {
		tier: row.risk_tier,
		score: row.risk_score,
		method: row.risk_method === 'model' || row.risk_method === 'heuristic' ? row.risk_method : null,
		factors: Array.isArray(row.risk_factors)
			? row.risk_factors.filter((f): f is string => typeof f === 'string')
			: [],
		trusted: row.risk_trusted_at !== null,
	};
}

export function toDashboardBooking(row: BookingRow, zone: TimeZone): DashboardBooking {
	const startsAt = instantFromIso(row.starts_at);
	const endsAt = instantFromIso(row.ends_at);
	const date = localDateOf(startsAt, zone);
	const markedAt = row.outcome_marked_at ? instantFromIso(row.outcome_marked_at) : null;
	return {
		id: row.id,
		status: row.status as BookingStatus,
		source: row.source,
		startsAtMs: startsAt,
		endsAtMs: endsAt,
		blockedUntilMs: instantFromIso(row.blocked_until),
		date,
		time: hhmm(startsAt, zone),
		dateLabel: dateLabel(date),
		timeLabel: `${formatLocalTime(startsAt, zone)} – ${formatLocalTime(endsAt, zone)}`,
		staffId: row.staff_id,
		staffName: row.staff.display_name,
		serviceId: row.service_id,
		serviceName: row.service.name,
		clientId: row.client_id,
		clientName: row.client.name,
		clientPhone: row.client.phone_e164,
		priceCents: row.price_cents,
		notes: row.client_notes,
		cancelReason: row.cancel_reason,
		createdLabel: formatSlotLabel(instantFromIso(row.created_at), zone),
		undoUntilMs: markedAt
			? zonedToInstant(plusDays(localDateOf(markedAt, zone), 1), 0, zone)
			: null,
		risk: toBookingRisk(row),
		confirmation: isConfirmationStatus(row.confirmation_status)
			? row.confirmation_status
			: 'not_required',
		confirmationDueLabel: row.confirmation_due_at
			? formatSlotLabel(instantFromIso(row.confirmation_due_at), zone)
			: null,
	};
}

/** Bookings starting in `window` (any status unless filtered), with client, service and staff names. */
export async function loadBookings(
	db: Db,
	shop: BookingShop,
	window: SchedulingWindow,
	options: { staffIds?: readonly string[]; includeCancelled?: boolean } = {},
): Promise<DashboardBooking[]> {
	let query = db
		.from('bookings')
		.select(BOOKING_COLUMNS)
		.eq('shop_id', shop.id)
		.gte('starts_at', instantToIso(addMinutes(window.start, -MAX_BOOKING_SPAN_MINUTES)))
		.lt('starts_at', instantToIso(window.end))
		.gt('blocked_until', instantToIso(window.start));
	if (options.staffIds) query = query.in('staff_id', [...options.staffIds]);
	// Released bookings stay visible so the owner can see what confirm-or-release did.
	if (!options.includeCancelled)
		query = query.or('status.neq.cancelled,release_reason.not.is.null');
	const { data, error } = await query.order('starts_at').order('id');
	if (error) throw error;
	return data.map((row) => toDashboardBooking(row, shop.timezone));
}

export async function loadBooking(
	db: Db,
	shop: BookingShop,
	bookingId: string,
): Promise<DashboardBooking | null> {
	const { data, error } = await db
		.from('bookings')
		.select(BOOKING_COLUMNS)
		.eq('shop_id', shop.id)
		.eq('id', bookingId)
		.maybeSingle();
	if (error) throw error;
	return data ? toDashboardBooking(data, shop.timezone) : null;
}

/** Confirmed bookings that have ended, oldest first; `staffId` narrows to one person's. */
export async function loadUnmarked(
	db: Db,
	shop: BookingShop,
	now: Instant,
	staffId?: string | null,
): Promise<{ bookings: DashboardBooking[]; total: number }> {
	let query = db
		.from('bookings')
		.select(BOOKING_COLUMNS, { count: 'exact' })
		.eq('shop_id', shop.id)
		.eq('status', 'confirmed')
		.lte('ends_at', instantToIso(now));
	if (staffId) query = query.eq('staff_id', staffId);
	const { data, count, error } = await query.order('ends_at').order('id').limit(UNMARKED_LIMIT);
	if (error) throw error;
	return {
		bookings: data.map((row) => toDashboardBooking(row, shop.timezone)),
		total: count ?? data.length,
	};
}

export async function countUnmarked(
	db: Db,
	shop: BookingShop,
	now: Instant,
	staffId?: string | null,
): Promise<number> {
	let query = db
		.from('bookings')
		.select('id', { count: 'exact', head: true })
		.eq('shop_id', shop.id)
		.eq('status', 'confirmed')
		.lte('ends_at', instantToIso(now));
	if (staffId) query = query.eq('staff_id', staffId);
	const { count, error } = await query;
	if (error) throw error;
	return count ?? 0;
}

export async function loadScheduleShading(
	db: Db,
	shop: BookingShop,
	staffIds: readonly string[],
	window: SchedulingWindow,
): Promise<{ rules: AvailabilityRule[]; timeOff: TimeOff[] }> {
	const ids = [...staffIds];
	const [rules, timeOff] = await Promise.all([
		db
			.from('availability_rules')
			.select('staff_id, weekday, start_time, end_time')
			.eq('shop_id', shop.id)
			.in('staff_id', ids),
		db
			.from('time_off')
			.select('staff_id, starts_at, ends_at')
			.eq('shop_id', shop.id)
			.in('staff_id', ids)
			.lt('starts_at', instantToIso(window.end))
			.gt('ends_at', instantToIso(window.start)),
	]);
	if (rules.error) throw rules.error;
	if (timeOff.error) throw timeOff.error;
	return {
		rules: rules.data.map((r) => ({
			staffId: r.staff_id,
			weekday: r.weekday,
			startTime: localTime(r.start_time),
			endTime: localTime(r.end_time),
		})),
		timeOff: timeOff.data.map((t) => ({
			staffId: t.staff_id,
			startsAt: instantFromIso(t.starts_at),
			endsAt: instantFromIso(t.ends_at),
		})),
	};
}

/** Free starts for one staff member on one day, ignoring the public lead time. */
export async function staffFreeSlots(
	db: Db,
	shop: BookingShop,
	service: BookableService,
	staffIds: readonly string[],
	date: LocalDate,
	now: Instant,
	excludeBookingId?: string,
) {
	const ctx = await loadSchedulingContext(
		db,
		shop,
		service,
		staffIds,
		dayWindow(date, shop.timezone),
		now,
		excludeBookingId,
	);
	return generateSlots({
		...ctx,
		settings: staffSettings(shop),
		staffIds,
		range: { from: date, to: date },
	});
}

export async function suggestedSlots(
	db: Db,
	shop: BookingShop,
	service: BookableService,
	staffId: string,
	requested: Instant,
	now: Instant,
	excludeBookingId?: string,
): Promise<DashboardSlot[]> {
	const date = localDateOf(requested, shop.timezone);
	const slots = await staffFreeSlots(db, shop, service, [staffId], date, now, excludeBookingId);
	return nearestSlots(slots, requested).map((s) => toDashboardSlot(s.startsAt, shop.timezone));
}

/** A live client to prefill the new-booking form, e.g. from "Book again". */
export async function loadClientMatch(
	db: Db,
	shopId: string,
	clientId: string,
): Promise<ClientMatch | null> {
	const { data, error } = await db
		.from('clients')
		.select('id, name, phone_e164')
		.eq('shop_id', shopId)
		.eq('id', clientId)
		.is('anonymised_at', null)
		.maybeSingle();
	if (error) throw error;
	return data ? { id: data.id, name: data.name, phone: data.phone_e164 } : null;
}

/** Name (contains) or phone (digits contained) search within the shop; at most 8 matches. */
export async function searchClients(db: Db, shopId: string, query: string): Promise<ClientMatch[]> {
	const pattern = clientSearchPattern(query);
	let request = db
		.from('clients')
		.select('id, name, phone_e164')
		.eq('shop_id', shopId)
		.is('anonymised_at', null);
	request =
		'phone' in pattern
			? request.like('phone_e164', pattern.phone)
			: request.ilike('name', pattern.name);
	const { data, error } = await request.order('name').order('id').limit(8);
	if (error) throw error;
	return data.map((c) => ({ id: c.id, name: c.name, phone: c.phone_e164 }));
}
