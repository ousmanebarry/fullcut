// Shared by generateSlots and validateRequestedStart so they can never disagree.
import {
	addLocalDays,
	addMinutes,
	localMinuteOfDay,
	parseLocalTime,
	weekdayOf,
	zonedToInstant,
	type Instant,
	type LocalDate,
} from '@/lib/time';
import { mergeIntervals, subtractIntervals, type Interval } from './intervals';
import type { SchedulingContext, ShopSchedulingSettings, StaffId } from './types';

const MS_PER_MINUTE = 60_000;

export function assertValidSettings(settings: ShopSchedulingSettings): void {
	const { slotStepMinutes, minLeadMinutes, maxHorizonDays } = settings;
	if (!Number.isInteger(slotStepMinutes) || slotStepMinutes <= 0) {
		throw new RangeError(`slotStepMinutes must be a positive integer: ${slotStepMinutes}`);
	}
	if (!Number.isInteger(minLeadMinutes) || minLeadMinutes < 0) {
		throw new RangeError(`minLeadMinutes must be a non-negative integer: ${minLeadMinutes}`);
	}
	if (!Number.isInteger(maxHorizonDays) || maxHorizonDays < 0) {
		throw new RangeError(`maxHorizonDays must be a non-negative integer: ${maxHorizonDays}`);
	}
}

/** Merged working hours for one staff member on one local date, as UTC intervals. */
export function workingWindows(
	staffId: StaffId,
	date: LocalDate,
	ctx: SchedulingContext,
): Interval[] {
	const weekday = weekdayOf(date);
	const zone = ctx.settings.timezone;
	return mergeIntervals(
		ctx.rules
			.filter((r) => r.staffId === staffId && r.weekday === weekday)
			.map((r) => ({
				start: zonedToInstant(date, parseLocalTime(r.startTime), zone),
				end: zonedToInstant(date, parseLocalTime(r.endTime), zone),
			})),
	);
}

export function timeOffIntervals(staffId: StaffId, ctx: SchedulingContext): Interval[] {
	return ctx.timeOff
		.filter((t) => t.staffId === staffId)
		.map((t) => ({ start: t.startsAt, end: t.endsAt }));
}

export function bookingIntervals(staffId: StaffId, ctx: SchedulingContext): Interval[] {
	return ctx.bookings
		.filter((b) => b.staffId === staffId)
		.map((b) => ({ start: b.startsAt, end: b.blockedUntil }));
}

export function freeIntervals(
	staffId: StaffId,
	date: LocalDate,
	ctx: SchedulingContext,
): Interval[] {
	return subtractIntervals(
		subtractIntervals(workingWindows(staffId, date, ctx), timeOffIntervals(staffId, ctx)),
		bookingIntervals(staffId, ctx),
	);
}

/** Earliest and latest allowed start instants, both inclusive. */
export function bookableStartRange(ctx: SchedulingContext): Interval {
	return {
		start: addMinutes(ctx.now, ctx.settings.minLeadMinutes),
		end: addLocalDays(ctx.now, ctx.settings.maxHorizonDays, ctx.settings.timezone),
	};
}

/** On a whole minute whose local minute-of-day is a multiple of the slot step. */
export function isAligned(instant: Instant, settings: ShopSchedulingSettings): boolean {
	return (
		instant % MS_PER_MINUTE === 0 &&
		localMinuteOfDay(instant, settings.timezone) % settings.slotStepMinutes === 0
	);
}

/** First aligned instant at or after `instant`; walks minute by minute so offset changes can't skip alignment. */
export function alignUp(instant: Instant, settings: ShopSchedulingSettings): Instant {
	let candidate = (Math.ceil(instant / MS_PER_MINUTE) * MS_PER_MINUTE) as Instant;
	while (!isAligned(candidate, settings)) candidate = addMinutes(candidate, 1);
	return candidate;
}
