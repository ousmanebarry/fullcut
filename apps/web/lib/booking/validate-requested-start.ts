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

/**
 * Friendly pre-check for a requested start; the DB exclusion constraint remains the final judge.
 * For a reschedule, leave the booking being moved out of `bookings`.
 */
export function validateRequestedStart(
	input: SchedulingContext & { staffId: StaffId; startsAt: Instant },
): Result<BookingTimes, StartRejection> {
	assertValidSettings(input.settings);
	const { staffId, startsAt } = input;
	const bounds = bookableStartRange(input);

	if (!isAligned(startsAt, input.settings)) return reject('misaligned');
	if (startsAt < bounds.start) return reject('too_soon');
	if (startsAt > bounds.end) return reject('too_far');

	const times = computeBookingTimes({
		startsAt,
		service: input.service,
		durationOverrideMinutes: input.durationOverrideMinutesByStaff?.[staffId],
	});
	const requested = { start: startsAt, end: times.blockedUntil };
	const fits = (intervals: readonly Interval[]) =>
		intervals.some((i) => containsInterval(i, requested));

	const windows = workingWindows(staffId, localDateOf(startsAt, input.settings.timezone), input);
	if (!fits(windows)) return reject('outside_hours');
	const afterTimeOff = subtractIntervals(windows, timeOffIntervals(staffId, input));
	if (!fits(afterTimeOff)) return reject('time_off');
	if (!fits(subtractIntervals(afterTimeOff, bookingIntervals(staffId, input))))
		return reject('conflict');

	return { ok: true, value: times };
}

function reject(error: StartRejection): Result<never, StartRejection> {
	return { ok: false, error };
}
