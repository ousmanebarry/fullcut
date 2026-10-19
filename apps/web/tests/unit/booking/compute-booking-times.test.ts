import { describe, expect, it } from 'vitest';
import { computeBookingTimes } from '@/lib/booking/compute-booking-times';
import { instantFromIso, instantToIso } from '@/lib/time';

const isoTimes = (t: ReturnType<typeof computeBookingTimes>) => ({
	startsAt: instantToIso(t.startsAt),
	endsAt: instantToIso(t.endsAt),
	blockedUntil: instantToIso(t.blockedUntil),
});

describe('computeBookingTimes', () => {
	const startsAt = instantFromIso('2026-03-10T14:00:00Z');

	it('adds duration then buffer', () => {
		expect(
			isoTimes(
				computeBookingTimes({ startsAt, service: { durationMinutes: 30, bufferMinutes: 10 } }),
			),
		).toEqual({
			startsAt: '2026-03-10T14:00:00.000Z',
			endsAt: '2026-03-10T14:30:00.000Z',
			blockedUntil: '2026-03-10T14:40:00.000Z',
		});
	});

	it('ends and blocks at the same instant with no buffer', () => {
		const t = computeBookingTimes({ startsAt, service: { durationMinutes: 45, bufferMinutes: 0 } });
		expect(t.blockedUntil).toBe(t.endsAt);
	});

	it('uses the duration override but keeps the service buffer', () => {
		const t = computeBookingTimes({
			startsAt,
			service: { durationMinutes: 30, bufferMinutes: 5 },
			durationOverrideMinutes: 42,
		});
		expect(instantToIso(t.endsAt)).toBe('2026-03-10T14:42:00.000Z');
		expect(instantToIso(t.blockedUntil)).toBe('2026-03-10T14:47:00.000Z');
	});

	it('counts real minutes across the spring-forward change', () => {
		// 01:45 EST + 30 min = 03:15 EDT local, 30 real minutes.
		const t = computeBookingTimes({
			startsAt: instantFromIso('2026-03-08T06:45:00Z'),
			service: { durationMinutes: 30, bufferMinutes: 0 },
		});
		expect(instantToIso(t.endsAt)).toBe('2026-03-08T07:15:00.000Z');
	});

	it('rejects non-positive durations and negative buffers', () => {
		expect(() =>
			computeBookingTimes({ startsAt, service: { durationMinutes: 0, bufferMinutes: 0 } }),
		).toThrow();
		expect(() =>
			computeBookingTimes({ startsAt, service: { durationMinutes: 30, bufferMinutes: -5 } }),
		).toThrow();
		expect(() =>
			computeBookingTimes({
				startsAt,
				service: { durationMinutes: 30, bufferMinutes: 0 },
				durationOverrideMinutes: 0,
			}),
		).toThrow();
	});
});
