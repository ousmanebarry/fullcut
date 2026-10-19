import { describe, expect, it } from 'vitest';
import { timeOffToInstants } from '@/lib/shop/time-off';
import { instantToIso, timeZone } from '@/lib/time';

const toronto = timeZone('America/Toronto');

function isoRange(result: ReturnType<typeof timeOffToInstants>) {
	if (!result.ok) throw new Error(result.error);
	return [instantToIso(result.value.startsAt), instantToIso(result.value.endsAt)];
}

describe('timeOffToInstants', () => {
	it('converts a timed range in the shop timezone', () => {
		const result = timeOffToInstants(
			{
				startDate: '2026-07-14',
				endDate: '2026-07-14',
				allDay: false,
				startTime: '12:00',
				endTime: '15:30',
			},
			toronto,
		);
		expect(isoRange(result)).toEqual(['2026-07-14T16:00:00.000Z', '2026-07-14T19:30:00.000Z']);
	});

	it('covers whole days for all-day ranges, through the end date', () => {
		const result = timeOffToInstants(
			{ startDate: '2026-12-24', endDate: '2026-12-26', allDay: true },
			toronto,
		);
		expect(isoRange(result)).toEqual(['2026-12-24T05:00:00.000Z', '2026-12-27T05:00:00.000Z']);
	});

	it('handles a DST change inside the range (spring forward is a 23-hour day)', () => {
		const result = timeOffToInstants(
			{ startDate: '2026-03-08', endDate: '2026-03-08', allDay: true },
			toronto,
		);
		if (!result.ok) throw new Error(result.error);
		expect(isoRange(result)).toEqual(['2026-03-08T05:00:00.000Z', '2026-03-09T04:00:00.000Z']);
		expect(result.value.endsAt - result.value.startsAt).toBe(23 * 3_600_000);
	});

	it('handles fall back (25-hour day)', () => {
		const result = timeOffToInstants(
			{ startDate: '2026-11-01', endDate: '2026-11-01', allDay: true },
			toronto,
		);
		if (!result.ok) throw new Error(result.error);
		expect(result.value.endsAt - result.value.startsAt).toBe(25 * 3_600_000);
	});

	it('rejects an end before or equal to the start', () => {
		expect(
			timeOffToInstants(
				{
					startDate: '2026-07-14',
					endDate: '2026-07-14',
					allDay: false,
					startTime: '15:00',
					endTime: '15:00',
				},
				toronto,
			),
		).toEqual({ ok: false, error: 'End must be after start.' });
		expect(
			timeOffToInstants({ startDate: '2026-07-15', endDate: '2026-07-14', allDay: true }, toronto)
				.ok,
		).toBe(false);
	});
});
