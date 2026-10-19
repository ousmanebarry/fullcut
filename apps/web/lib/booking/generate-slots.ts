import {
	addMinutes,
	eachLocalDate,
	formatSlotLabel,
	localDateOf,
	type Instant,
	type LocalDate,
} from '@/lib/time';
import { alignUp, assertValidSettings, bookableStartRange, freeIntervals } from './availability';
import { computeBookingTimes } from './compute-booking-times';
import type { LocalDateRange, SchedulingContext, Slot, StaffId } from './types';

export interface GenerateSlotsInput extends SchedulingContext {
	/** One id for a specific stylist; several for "any staff" (order breaks ties). */
	staffIds: readonly StaffId[];
	range: LocalDateRange;
}

/**
 * Bookable start times, one per instant, sorted ascending. When several staff are free at the same
 * start, picks the one with the fewest existing bookings that local day, then the earliest in `staffIds`.
 */
export function generateSlots(input: GenerateSlotsInput): Slot[] {
	assertValidSettings(input.settings);
	const { settings, staffIds } = input;
	const zone = settings.timezone;
	const bounds = bookableStartRange(input);
	const bookingsPerStaffDay = countBookingsPerStaffDay(input);
	const chosen = new Map<Instant, { staffId: StaffId; dayBookings: number }>();

	for (const date of eachLocalDate(input.range.from, input.range.to)) {
		for (const staffId of staffIds) {
			const dayBookings = bookingsPerStaffDay.get(dayKey(staffId, date)) ?? 0;
			for (const startsAt of staffStarts(staffId, date, input, bounds)) {
				const current = chosen.get(startsAt);
				if (!current || dayBookings < current.dayBookings)
					chosen.set(startsAt, { staffId, dayBookings });
			}
		}
	}

	return [...chosen]
		.sort(([a], [b]) => a - b)
		.map(([startsAt, { staffId }]) => ({
			startsAt,
			staffId,
			localLabel: formatSlotLabel(startsAt, zone),
		}));
}

function* staffStarts(
	staffId: StaffId,
	date: LocalDate,
	input: GenerateSlotsInput,
	bounds: { start: Instant; end: Instant },
): Generator<Instant> {
	const durationOverrideMinutes = input.durationOverrideMinutesByStaff?.[staffId];
	for (const free of freeIntervals(staffId, date, input)) {
		let startsAt = alignUp(free.start > bounds.start ? free.start : bounds.start, input.settings);
		while (startsAt <= bounds.end) {
			const { blockedUntil } = computeBookingTimes({
				startsAt,
				service: input.service,
				durationOverrideMinutes,
			});
			if (blockedUntil > free.end) break;
			yield startsAt;
			startsAt = alignUp(addMinutes(startsAt, input.settings.slotStepMinutes), input.settings);
		}
	}
}

function countBookingsPerStaffDay(input: GenerateSlotsInput): Map<string, number> {
	const counts = new Map<string, number>();
	for (const b of input.bookings) {
		const key = dayKey(b.staffId, localDateOf(b.startsAt, input.settings.timezone));
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	return counts;
}

function dayKey(staffId: StaffId, date: LocalDate): string {
	return `${staffId}|${date}`;
}
