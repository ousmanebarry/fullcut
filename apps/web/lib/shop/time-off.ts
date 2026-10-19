import type { Result } from '@/lib/booking/types';
import { localDate, zonedToInstant, type Instant, type TimeZone } from '@/lib/time';

export interface TimeOffInput {
	startDate: string;
	endDate: string;
	allDay: boolean;
	startTime?: string;
	endTime?: string;
}

function minutesOf(time: string | undefined): number {
	if (!time) throw new RangeError('A time is required when the range is not all day.');
	return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

/** Converts a shop-local date/time range to instants; all-day ranges cover the whole end date. */
export function timeOffToInstants(
	input: TimeOffInput,
	zone: TimeZone,
): Result<{ startsAt: Instant; endsAt: Instant }, string> {
	const startsAt = zonedToInstant(
		localDate(input.startDate),
		input.allDay ? 0 : minutesOf(input.startTime),
		zone,
	);
	const endsAt = zonedToInstant(
		localDate(input.endDate),
		input.allDay ? 1440 : minutesOf(input.endTime),
		zone,
	);
	if (endsAt <= startsAt) return { ok: false, error: 'End must be after start.' };
	return { ok: true, value: { startsAt, endsAt } };
}
