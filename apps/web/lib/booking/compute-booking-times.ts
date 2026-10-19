import { addMinutes, type Instant } from '@/lib/time';
import type { BookingTimes, Service } from './types';

export function computeBookingTimes(input: {
	startsAt: Instant;
	service: Service;
	durationOverrideMinutes?: number;
}): BookingTimes {
	const duration = input.durationOverrideMinutes ?? input.service.durationMinutes;
	const buffer = input.service.bufferMinutes;
	if (!Number.isInteger(duration) || duration <= 0) {
		throw new RangeError(`Duration must be a positive whole number of minutes: ${duration}`);
	}
	if (!Number.isInteger(buffer) || buffer < 0) {
		throw new RangeError(`Buffer must be a non-negative whole number of minutes: ${buffer}`);
	}
	const endsAt = addMinutes(input.startsAt, duration);
	return { startsAt: input.startsAt, endsAt, blockedUntil: addMinutes(endsAt, buffer) };
}
