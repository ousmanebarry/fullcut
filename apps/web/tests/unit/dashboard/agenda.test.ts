import { describe, expect, it } from 'vitest';
import { buildAgenda, isClosedAllDay, minuteLabel } from '@/lib/dashboard/agenda';
import type { LayoutColumn } from '@/lib/dashboard/calendar-layout';

// Open 9:00–17:00, a 10:00–10:30 booking with a 10 min buffer, time off 13:00–14:00.
function column(overrides: Partial<LayoutColumn> = {}): LayoutColumn {
	return {
		key: 'staff-1',
		staffId: 'staff-1',
		date: '2026-11-02' as LayoutColumn['date'],
		title: 'Alex',
		blocks: [{ bookingId: 'b1', topMin: 600, heightMin: 30, bufferMin: 10, lane: 0, lanes: 1 }],
		shades: [
			{ topMin: 0, heightMin: 540, kind: 'closed' },
			{ topMin: 1020, heightMin: 420, kind: 'closed' },
			{ topMin: 780, heightMin: 60, kind: 'time_off' },
		],
		...overrides,
	};
}

describe('buildAgenda', () => {
	it('lists bookings, time off and the free gaps between them in order', () => {
		expect(buildAgenda(column())).toEqual([
			{ kind: 'free', startMin: 540, endMin: 600 },
			{ kind: 'booking', bookingId: 'b1', startMin: 600, endMin: 630 },
			{ kind: 'free', startMin: 640, endMin: 780 },
			{ kind: 'time_off', startMin: 780, endMin: 840 },
			{ kind: 'free', startMin: 840, endMin: 1020 },
		]);
	});

	it('only offers free time from the given minute, rounded up to 5', () => {
		const items = buildAgenda(column(), 701);
		expect(items.filter((i) => i.kind === 'free')).toEqual([
			{ kind: 'free', startMin: 705, endMin: 780 },
			{ kind: 'free', startMin: 840, endMin: 1020 },
		]);
		expect(items.some((i) => i.kind === 'booking')).toBe(true);
	});

	it('drops gaps shorter than 15 minutes', () => {
		const items = buildAgenda(
			column({
				blocks: [{ bookingId: 'b1', topMin: 550, heightMin: 450, bufferMin: 0, lane: 0, lanes: 1 }],
				shades: [
					{ topMin: 0, heightMin: 540, kind: 'closed' },
					{ topMin: 1010, heightMin: 430, kind: 'closed' },
				],
			}),
		);
		expect(items).toEqual([{ kind: 'booking', bookingId: 'b1', startMin: 550, endMin: 1000 }]);
	});

	it('shows no free time on past days', () => {
		expect(buildAgenda(column(), 1440).map((i) => i.kind)).toEqual(['booking', 'time_off']);
	});
});

describe('isClosedAllDay', () => {
	it('is true only when there are no working hours', () => {
		expect(isClosedAllDay(column())).toBe(false);
		expect(
			isClosedAllDay(column({ shades: [{ topMin: 0, heightMin: 1440, kind: 'closed' }] })),
		).toBe(true);
	});
});

describe('minuteLabel', () => {
	it('formats wall-clock minutes as 12-hour times', () => {
		expect(minuteLabel(0)).toBe('12:00 AM');
		expect(minuteLabel(9 * 60 + 5)).toBe('9:05 AM');
		expect(minuteLabel(12 * 60)).toBe('12:00 PM');
		expect(minuteLabel(17 * 60 + 30)).toBe('5:30 PM');
	});
});
