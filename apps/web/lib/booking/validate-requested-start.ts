import { localDateOf, type Instant } from '@/lib/time';
import {
	assertValidSettings,
	bookableStartRange,
	bookingIntervals,
	isAligned,
	timeOffIntervals,
	workingWindows,
} from './availability';
import { computeBookingTimes } from './compute-booking-times';
import { containsInterval, subtractIntervals, type Interval } from './intervals';
import type { BookingTimes, Result, SchedulingContext, StaffId } from './types';

export type StartRejection =
	'misaligned' | 'too_soon' | 'too_far' | 'outside_hours' | 'time_off' | 'conflict';

export type StaffStartRejection = Extract<
	StartRejection,
	'misaligned' | 'outside_hours' | 'time_off' | 'conflict'
>;

type StartInput = SchedulingContext & { staffId: StaffId; startsAt: Instant };

/**
 * Friendly pre-check for a requested start; the DB exclusion constraint remains the final judge.
 * For a reschedule, leave the booking being moved out of `bookings`.
 */
export function validateRequestedStart(input: StartInput): Result<BookingTimes, StartRejection> {
	assertValidSettings(input.settings);
	const { startsAt } = input;
	const bounds = bookableStartRange(input);

	if (!isAligned(startsAt, input.settings)) return reject('misaligned');
	if (startsAt < bounds.start) return reject('too_soon');
	if (startsAt > bounds.end) return reject('too_far');
	return checkFit(input, false);
}

/**
 * Pre-check for bookings made by staff: no lead time, horizon or slot-step rules, so past starts
 * (walk-ins) are allowed. `overrideHours` (owners only) also skips working hours and time off.
 */
export function validateStaffStart(
	input: StartInput & { overrideHours?: boolean },
): Result<BookingTimes, StaffStartRejection> {
	if (input.startsAt % 60_000 !== 0) return reject('misaligned');
	return checkFit(input, input.overrideHours ?? false);
}

function checkFit(
	input: StartInput,
	overrideHours: boolean,
): Result<BookingTimes, 'outside_hours' | 'time_off' | 'conflict'> {
	const { staffId, startsAt } = input;
	const times = computeBookingTimes({
		startsAt,
		service: input.service,
		durationOverrideMinutes: input.durationOverrideMinutesByStaff?.[staffId],
	});
	const requested = { start: startsAt, end: times.blockedUntil };
	const fits = (intervals: readonly Interval[]) =>
		intervals.some((i) => containsInterval(i, requested));

	if (overrideHours) {
		const clash = bookingIntervals(staffId, input).some(
			(b) => b.start < requested.end && requested.start < b.end,
		);
		return clash ? reject('conflict') : { ok: true, value: times };
	}

	const windows = workingWindows(staffId, localDateOf(startsAt, input.settings.timezone), input);
	if (!fits(windows)) return reject('outside_hours');
	const afterTimeOff = subtractIntervals(windows, timeOffIntervals(staffId, input));
	if (!fits(afterTimeOff)) return reject('time_off');
	if (!fits(subtractIntervals(afterTimeOff, bookingIntervals(staffId, input))))
		return reject('conflict');

	return { ok: true, value: times };
}

function reject<E extends StartRejection>(error: E): Result<never, E> {
	return { ok: false, error };
}
