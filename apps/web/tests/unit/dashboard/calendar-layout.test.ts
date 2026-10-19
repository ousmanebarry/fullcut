import { describe, expect, it } from 'vitest';
import {
	buildCalendarLayout,
	hourLabel,
	type LayoutBooking,
	type LayoutInput,
} from '@/lib/dashboard/calendar-layout';
import { localDate, type LocalDate } from '@/lib/time';
import { at, rule, timeOff, toronto } from '../booking/fixtures';

const booking = (id: string, startsAt: string, minutes: number, buffer = 0): LayoutBooking => {
	const start = at(startsAt);
	return {
		id,
		staffId: 'sam',
		startsAt: start,
		endsAt: (start + minutes * 60_000) as LayoutBooking['endsAt'],
		blockedUntil: (start + (minutes + buffer) * 60_000) as LayoutBooking['blockedUntil'],
	};
};

const day = (date: string, overrides: Partial<LayoutInput> = {}) =>
	buildCalendarLayout({
		zone: toronto,
		columns: [{ key: 'sam', staffId: 'sam', date: localDate(date), title: 'Sam' }],
		bookings: [],
		rules: [],
		timeOff: [],
		...overrides,
	});

const column = (layout: ReturnType<typeof buildCalendarLayout>) => {
	const [first] = layout.columns;
	if (!first) throw new Error('no column');
	return first;
};

describe('buildCalendarLayout', () => {
	it('places a normal-day booking by local wall-clock time with its buffer tail', () => {
		// Tuesday 2026-03-10 is EDT (UTC-4).
		const layout = day('2026-03-10', {
			rules: [rule('sam', 2, '09:00', '17:00')],
			bookings: [booking('b1', '2026-03-10T13:00:00Z', 30, 10)],
		});
		expect(layout.startMin).toBe(9 * 60);
		expect(layout.endMin).toBe(17 * 60);
		expect(layout.hours.map((h) => h.label)).toEqual([
			'9 AM',
			'10 AM',
			'11 AM',
			'12 PM',
			'1 PM',
			'2 PM',
			'3 PM',
			'4 PM',
		]);
		expect(column(layout).blocks).toEqual([
			{ bookingId: 'b1', topMin: 540, heightMin: 30, bufferMin: 10, lane: 0, lanes: 1 },
		]);
		expect(column(layout).shades).toEqual([
			{ topMin: 0, heightMin: 540, kind: 'closed' },
			{ topMin: 1020, heightMin: 420, kind: 'closed' },
		]);
	});

	it('keeps wall-clock rows on the spring-forward day', () => {
		// 2026-03-08: 02:00 EST jumps to 03:00 EDT. 9:00 EDT is 13:00Z.
		const layout = day('2026-03-08', {
			rules: [rule('sam', 0, '09:00', '17:00')],
			bookings: [booking('b1', '2026-03-08T13:00:00Z', 30)],
		});
		expect(column(layout).blocks[0]).toMatchObject({ topMin: 540, heightMin: 30 });
		expect(column(layout).shades[0]).toEqual({ topMin: 0, heightMin: 540, kind: 'closed' });
	});

	it('sizes a booking across the spring-forward gap by real elapsed time', () => {
		// 01:30 EST (06:30Z) for 60 minutes ends at 03:30 EDT.
		const layout = day('2026-03-08', { bookings: [booking('b1', '2026-03-08T06:30:00Z', 60)] });
		expect(column(layout).blocks[0]).toMatchObject({ topMin: 90, heightMin: 60 });
	});

	it('keeps wall-clock rows on the fall-back day', () => {
		// 2026-11-01: 02:00 EDT falls back to 01:00 EST. 9:00 EST is 14:00Z.
		const layout = day('2026-11-01', {
			rules: [rule('sam', 0, '09:00', '17:00')],
			bookings: [booking('b1', '2026-11-01T14:00:00Z', 30, 10)],
		});
		expect(column(layout).blocks[0]).toMatchObject({ topMin: 540, heightMin: 30, bufferMin: 10 });
		expect(layout.endMin).toBe(17 * 60);
	});

	it('puts the two 1:30 AMs of the fall-back day side by side', () => {
		const layout = day('2026-11-01', {
			bookings: [
				booking('edt', '2026-11-01T05:30:00Z', 30),
				booking('est', '2026-11-01T06:30:00Z', 30),
			],
		});
		expect(column(layout).blocks).toEqual([
			{ bookingId: 'edt', topMin: 90, heightMin: 30, bufferMin: 0, lane: 0, lanes: 2 },
			{ bookingId: 'est', topMin: 90, heightMin: 30, bufferMin: 0, lane: 1, lanes: 2 },
		]);
		expect(layout.startMin).toBe(60);
	});

	it('clips time off and bookings to the day', () => {
		const layout = day('2026-03-10', {
			rules: [rule('sam', 2, '09:00', '17:00')],
			timeOff: [timeOff('sam', '2026-03-09T23:00:00Z', '2026-03-10T16:00:00Z')],
			bookings: [booking('late', '2026-03-11T03:30:00Z', 60)],
		});
		expect(column(layout).shades).toContainEqual({ topMin: 0, heightMin: 720, kind: 'time_off' });
		// 23:30 local for 60 minutes is cut at midnight.
		expect(column(layout).blocks[0]).toMatchObject({ topMin: 1410, heightMin: 30 });
		expect(layout.endMin).toBe(1440);
	});

	it('shows each day of a week view in its own column', () => {
		const dates = ['2026-03-09', '2026-03-10', '2026-03-11'].map((d) => localDate(d));
		const layout = buildCalendarLayout({
			zone: toronto,
			columns: dates.map((date: LocalDate) => ({ key: date, staffId: 'sam', date, title: date })),
			bookings: [booking('b1', '2026-03-10T14:00:00Z', 30)],
			rules: [],
			timeOff: [],
		});
		expect(layout.columns.map((c) => c.blocks.length)).toEqual([0, 1, 0]);
	});

	it('defaults to 8 AM – 8 PM with nothing scheduled', () => {
		const layout = day('2026-03-10');
		expect([layout.startMin, layout.endMin]).toEqual([480, 1200]);
		expect(column(layout).shades).toEqual([{ topMin: 0, heightMin: 1440, kind: 'closed' }]);
	});

	it('ignores other staff', () => {
		const other = { ...booking('b1', '2026-03-10T13:00:00Z', 30), staffId: 'alex' };
		expect(column(day('2026-03-10', { bookings: [other] })).blocks).toEqual([]);
	});
});

describe('hourLabel', () => {
	it.each([
		[0, '12 AM'],
		[540, '9 AM'],
		[720, '12 PM'],
		[1380, '11 PM'],
	])('%i -> %s', (minute, label) => {
		expect(hourLabel(minute)).toBe(label);
	});
});
