import { describe, expect, it } from 'vitest';
import {
	addLocalDays,
	addMinutes,
	daysBetween,
	eachLocalDate,
	formatLocalTime,
	formatLongDateTime,
	formatSlotLabel,
	instantFromIso,
	instantToIso,
	localDate,
	localDateOf,
	localDateParts,
	localMinuteOfDay,
	localTime,
	parseLocalTime,
	plusDays,
	timeZone,
	weekdayOf,
	zonedToInstant,
	zoneLongName,
} from '@/lib/time';

const toronto = timeZone('America/Toronto');
const iso = instantToIso;

describe('constructors', () => {
	it('parses ISO instants with an offset and rejects ones without', () => {
		expect(instantFromIso('2026-03-08T05:00:00Z')).toBe(Date.UTC(2026, 2, 8, 5));
		expect(instantFromIso('2026-03-08T00:00:00-05:00')).toBe(Date.UTC(2026, 2, 8, 5));
		expect(() => instantFromIso('2026-03-08T05:00:00')).toThrow();
		expect(() => instantFromIso('nope')).toThrow();
	});

	it('round-trips to a UTC ISO string', () => {
		expect(instantToIso(instantFromIso('2026-03-08T00:00:00-05:00'))).toBe(
			'2026-03-08T05:00:00.000Z',
		);
	});

	it('validates local dates, local times and zones', () => {
		expect(localDate('2026-02-28')).toBe('2026-02-28');
		expect(() => localDate('2026-02-30')).toThrow();
		expect(() => localDate('2026-2-3')).toThrow();
		expect(localTime('09:00')).toBe('09:00');
		expect(localTime('17:30:00')).toBe('17:30:00');
		expect(localTime('24:00:00')).toBe('24:00:00');
		expect(() => localTime('24:30')).toThrow();
		expect(() => localTime('09:00:30')).toThrow();
		expect(() => timeZone('America/Nowhere')).toThrow();
	});

	it('parses local times into minutes since midnight', () => {
		expect(parseLocalTime(localTime('00:00'))).toBe(0);
		expect(parseLocalTime(localTime('09:15:00'))).toBe(555);
		expect(parseLocalTime(localTime('24:00'))).toBe(1440);
	});
});

describe('calendar helpers', () => {
	it('uses 0 = Sunday like the database', () => {
		expect(weekdayOf(localDate('2026-03-08'))).toBe(0);
		expect(weekdayOf(localDate('2026-03-09'))).toBe(1);
		expect(weekdayOf(localDate('2026-03-14'))).toBe(6);
	});

	it('lists local dates inclusively', () => {
		expect(eachLocalDate(localDate('2026-02-27'), localDate('2026-03-02'))).toEqual([
			'2026-02-27',
			'2026-02-28',
			'2026-03-01',
			'2026-03-02',
		]);
		expect(eachLocalDate(localDate('2026-03-02'), localDate('2026-03-01'))).toEqual([]);
	});

	it('adds absolute minutes', () => {
		const start = instantFromIso('2026-03-08T06:45:00Z');
		expect(iso(addMinutes(start, 30))).toBe('2026-03-08T07:15:00.000Z');
	});
});

describe('zone conversion in America/Toronto', () => {
	it('uses UTC-5 before and UTC-4 after spring forward (2026-03-08)', () => {
		expect(iso(zonedToInstant(localDate('2026-03-07'), 9 * 60, toronto))).toBe(
			'2026-03-07T14:00:00.000Z',
		);
		expect(iso(zonedToInstant(localDate('2026-03-09'), 9 * 60, toronto))).toBe(
			'2026-03-09T13:00:00.000Z',
		);
	});

	it('uses UTC-4 before and UTC-5 after fall back (2026-11-01)', () => {
		expect(iso(zonedToInstant(localDate('2026-10-31'), 9 * 60, toronto))).toBe(
			'2026-10-31T13:00:00.000Z',
		);
		expect(iso(zonedToInstant(localDate('2026-11-02'), 9 * 60, toronto))).toBe(
			'2026-11-02T14:00:00.000Z',
		);
	});

	it('moves a time inside the spring-forward gap forward', () => {
		expect(iso(zonedToInstant(localDate('2026-03-08'), 2 * 60 + 30, toronto))).toBe(
			'2026-03-08T07:30:00.000Z',
		);
	});

	it('resolves an ambiguous fall-back time to the earlier offset', () => {
		expect(iso(zonedToInstant(localDate('2026-11-01'), 60 + 30, toronto))).toBe(
			'2026-11-01T05:30:00.000Z',
		);
	});

	it('treats minute 1440 as midnight of the next day', () => {
		expect(iso(zonedToInstant(localDate('2026-03-07'), 1440, toronto))).toBe(
			'2026-03-08T05:00:00.000Z',
		);
	});

	it('reads local date and minute of day', () => {
		const i = instantFromIso('2026-11-01T06:30:00Z');
		expect(localDateOf(i, toronto)).toBe('2026-11-01');
		expect(localMinuteOfDay(i, toronto)).toBe(90);
		expect(localDateOf(instantFromIso('2026-11-01T03:59:00Z'), toronto)).toBe('2026-10-31');
	});

	it('adds calendar days in the zone across a DST change', () => {
		const sat = instantFromIso('2026-03-07T14:00:00Z');
		expect(iso(addLocalDays(sat, 2, toronto))).toBe('2026-03-09T13:00:00.000Z');
	});
});

describe('formatSlotLabel', () => {
	it('formats a normal time without a zone', () => {
		expect(formatSlotLabel(instantFromIso('2026-03-09T13:00:00Z'), toronto)).toBe(
			'Mon, Mar 9, 9:00 AM',
		);
	});

	it('disambiguates the repeated fall-back hour with the zone abbreviation', () => {
		expect(formatSlotLabel(instantFromIso('2026-11-01T05:30:00Z'), toronto)).toBe(
			'Sun, Nov 1, 1:30 AM EDT',
		);
		expect(formatSlotLabel(instantFromIso('2026-11-01T06:30:00Z'), toronto)).toBe(
			'Sun, Nov 1, 1:30 AM EST',
		);
		expect(formatSlotLabel(instantFromIso('2026-11-01T07:30:00Z'), toronto)).toBe(
			'Sun, Nov 1, 2:30 AM',
		);
	});
});

describe('display helpers', () => {
	it('formats a time of day, disambiguating the repeated fall-back hour', () => {
		expect(formatLocalTime(instantFromIso('2026-03-09T13:00:00Z'), toronto)).toBe('9:00 AM');
		expect(formatLocalTime(instantFromIso('2026-11-01T05:30:00Z'), toronto)).toBe('1:30 AM EDT');
		expect(formatLocalTime(instantFromIso('2026-11-01T06:30:00Z'), toronto)).toBe('1:30 AM EST');
	});

	it('formats a long date-time with the zone', () => {
		expect(formatLongDateTime(instantFromIso('2026-10-20T13:00:00Z'), toronto)).toBe(
			'Tuesday, October 20, 2026 at 9:00 AM EDT',
		);
	});

	it('splits a local date into day-picker parts', () => {
		expect(localDateParts(localDate('2026-10-20'))).toEqual({
			weekday: 'Tue',
			day: '20',
			month: 'Oct',
		});
	});

	it('does calendar-day arithmetic on local dates', () => {
		expect(plusDays(localDate('2026-02-27'), 2)).toBe('2026-03-01');
		expect(plusDays(localDate('2026-03-01'), -1)).toBe('2026-02-28');
		expect(daysBetween(localDate('2026-03-07'), localDate('2026-03-09'))).toBe(2);
		expect(daysBetween(localDate('2026-03-09'), localDate('2026-03-07'))).toBe(-2);
	});

	it('names the zone for the instant', () => {
		expect(zoneLongName(instantFromIso('2026-07-01T12:00:00Z'), toronto)).toBe(
			'Eastern Daylight Time',
		);
		expect(zoneLongName(instantFromIso('2026-12-01T12:00:00Z'), toronto)).toBe(
			'Eastern Standard Time',
		);
	});
});
