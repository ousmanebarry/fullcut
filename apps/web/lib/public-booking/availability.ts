import { generateSlots } from '@/lib/booking/generate-slots';
import type { BookingTimes, SchedulingContext, Slot } from '@/lib/booking/types';
import {
	validateRequestedStart,
	type StartRejection,
} from '@/lib/booking/validate-requested-start';
import type { Result } from '@/lib/booking/types';
import type { Db } from '@/lib/shop/settings';
import {
	eachLocalDate,
	formatLocalTime,
	localDateOf,
	localDateParts,
	localMinuteOfDay,
	plusDays,
	zonedToInstant,
	type Instant,
	type LocalDate,
	type TimeZone,
} from '@/lib/time';
import {
	loadActiveServices,
	loadActiveStaff,
	loadSchedulingContext,
	type BookableService,
	type BookableStaff,
	type BookingShop,
	type SchedulingWindow,
} from './data';
import type { AvailabilityQuery, StaffChoice } from './schemas';
import type { AvailabilityResponse, DayPeriod, PublicSlot } from './types';

const SUGGESTION_COUNT = 6;
const NEXT_OPEN_CHUNK_DAYS = 14;

export function periodOf(minuteOfDay: number): DayPeriod {
	if (minuteOfDay < 12 * 60) return 'morning';
	if (minuteOfDay < 17 * 60) return 'afternoon';
	return 'evening';
}

export function toPublicSlot(slot: Slot, zone: TimeZone): PublicSlot {
	return {
		startsAt: new Date(slot.startsAt).toISOString(),
		staffId: slot.staffId,
		label: slot.localLabel,
		date: localDateOf(slot.startsAt, zone),
		time: formatLocalTime(slot.startsAt, zone),
		period: periodOf(localMinuteOfDay(slot.startsAt, zone)),
	};
}

/** The `limit` slots closest to `requested` (excluding it), in time order. */
export function nearestSlots(
	slots: readonly Slot[],
	requested: Instant,
	limit = SUGGESTION_COUNT,
): Slot[] {
	return slots
		.filter((s) => s.startsAt !== requested)
		.toSorted(
			(a, b) =>
				Math.abs(a.startsAt - requested) - Math.abs(b.startsAt - requested) ||
				a.startsAt - b.startsAt,
		)
		.slice(0, limit)
		.toSorted((a, b) => a.startsAt - b.startsAt);
}

export function dateWindow(from: LocalDate, to: LocalDate, zone: TimeZone): SchedulingWindow {
	return { start: zonedToInstant(from, 0, zone), end: zonedToInstant(to, 1440, zone) };
}

export function lastBookableDate(shop: BookingShop, now: Instant): LocalDate {
	return plusDays(localDateOf(now, shop.timezone), shop.settings.maxHorizonDays);
}

/** Active staff ids for a choice, or null when a specific stylist is not bookable. */
export function staffIdsFor(choice: StaffChoice, staff: readonly BookableStaff[]): string[] | null {
	if (choice === 'any') return staff.map((s) => s.id);
	return staff.some((s) => s.id === choice) ? [choice] : null;
}

export type AvailabilityError = 'service_not_found' | 'staff_not_found';

export async function getAvailability(
	db: Db,
	shop: BookingShop,
	query: AvailabilityQuery,
	now: Instant,
): Promise<Result<AvailabilityResponse, AvailabilityError>> {
	const [services, staff] = await Promise.all([
		loadActiveServices(db, shop.id),
		loadActiveStaff(db, shop.id),
	]);
	const service = services.find((s) => s.id === query.serviceId);
	if (!service) return { ok: false, error: 'service_not_found' };
	const staffIds = staffIdsFor(query.staffId, staff);
	if (!staffIds) return { ok: false, error: 'staff_not_found' };

	const zone = shop.timezone;
	const days = eachLocalDate(query.from, query.to).map((date) => ({
		date,
		...localDateParts(date),
	}));
	if (staffIds.length === 0) {
		return { ok: true, value: { timezone: zone, days, slots: [], nextOpenDate: null } };
	}

	const range = { from: query.from, to: query.to };
	const ctx = await loadSchedulingContext(
		db,
		shop,
		service,
		staffIds,
		dateWindow(range.from, range.to, zone),
		now,
	);
	const slots = generateSlots({ ...ctx, staffIds, range });
	const nextOpenDate = slots[0]
		? localDateOf(slots[0].startsAt, zone)
		: await findNextOpenDate(db, shop, service, staffIds, plusDays(query.to, 1), now);

	return {
		ok: true,
		value: {
			timezone: zone,
			days,
			slots: slots.map((s) => toPublicSlot(s, zone)),
			nextOpenDate,
		},
	};
}

async function findNextOpenDate(
	db: Db,
	shop: BookingShop,
	service: BookableService,
	staffIds: readonly string[],
	from: LocalDate,
	now: Instant,
): Promise<LocalDate | null> {
	const last = lastBookableDate(shop, now);
	if (from > last) return null;
	const ctx = await loadSchedulingContext(
		db,
		shop,
		service,
		staffIds,
		dateWindow(from, last, shop.timezone),
		now,
	);
	for (
		let chunkStart = from;
		chunkStart <= last;
		chunkStart = plusDays(chunkStart, NEXT_OPEN_CHUNK_DAYS)
	) {
		const chunkEnd = plusDays(chunkStart, NEXT_OPEN_CHUNK_DAYS - 1);
		const range = { from: chunkStart, to: chunkEnd < last ? chunkEnd : last };
		const [first] = generateSlots({ ...ctx, staffIds, range });
		if (first) return localDateOf(first.startsAt, shop.timezone);
	}
	return null;
}

export interface StaffCandidate {
	staffId: string;
	times: BookingTimes;
}

// When every stylist rejects a start, report the reason most useful to the client.
const REJECTION_PRIORITY: readonly StartRejection[] = [
	'misaligned',
	'too_soon',
	'too_far',
	'conflict',
	'time_off',
	'outside_hours',
];

/**
 * Staff who can take `startsAt`, best first (the same pick `generateSlots` makes for "any"),
 * so a lost race on one stylist can fall back to the next.
 */
export function candidatesForStart(
	ctx: SchedulingContext,
	staffIds: readonly string[],
	startsAt: Instant,
): Result<StaffCandidate[], StartRejection> {
	const rejections = new Set<StartRejection>();
	const candidates: StaffCandidate[] = [];
	for (const staffId of staffIds) {
		const result = validateRequestedStart({ ...ctx, staffId, startsAt });
		if (result.ok) candidates.push({ staffId, times: result.value });
		else rejections.add(result.error);
	}
	if (candidates.length === 0) {
		const reason = REJECTION_PRIORITY.find((r) => rejections.has(r)) ?? 'outside_hours';
		return { ok: false, error: reason };
	}
	if (candidates.length > 1) {
		const date = localDateOf(startsAt, ctx.settings.timezone);
		const picked = generateSlots({
			...ctx,
			staffIds: candidates.map((c) => c.staffId),
			range: { from: date, to: date },
		}).find((s) => s.startsAt === startsAt)?.staffId;
		candidates.sort((a, b) => Number(b.staffId === picked) - Number(a.staffId === picked));
	}
	return { ok: true, value: candidates };
}

/** Open slots nearest `startsAt`, looking at that shop-local day and the days either side. */
export async function suggestionsNear(
	db: Db,
	shop: BookingShop,
	service: BookableService,
	staffIds: readonly string[],
	startsAt: Instant,
	now: Instant,
	excludeBookingId?: string,
): Promise<PublicSlot[]> {
	const date = localDateOf(startsAt, shop.timezone);
	const range = { from: plusDays(date, -1), to: plusDays(date, 1) };
	const ctx = await loadSchedulingContext(
		db,
		shop,
		service,
		staffIds,
		dateWindow(range.from, range.to, shop.timezone),
		now,
		excludeBookingId,
	);
	return nearestSlots(generateSlots({ ...ctx, staffIds, range }), startsAt).map((s) =>
		toPublicSlot(s, shop.timezone),
	);
}
