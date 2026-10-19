import { describe, expect, it } from 'vitest';
import {
	defaultWeeklyHours,
	hoursToRules,
	rulesToHours,
	validateDay,
	weeklyHoursJsonSchema,
	weeklyHoursSchema,
	type WeeklyHours,
} from '@/lib/shop/hours';

function week(
	overrides: Partial<Record<number, WeeklyHours[number]['windows'] | null>>,
): WeeklyHours {
	return Array.from({ length: 7 }, (_, weekday) => {
		const windows = overrides[weekday];
		return {
			weekday,
			enabled: Boolean(windows),
			windows: windows ?? [{ start: '09:00', end: '17:00' }],
		};
	});
}

describe('hoursToRules', () => {
	it('turns enabled days into one rule per window, ignoring disabled days', () => {
		const hours = week({
			2: [{ start: '09:00', end: '17:00' }],
			3: [
				{ start: '13:00', end: '18:00' },
				{ start: '09:00', end: '12:00' },
			],
		});
		expect(hoursToRules(hours)).toEqual([
			{ weekday: 2, start_time: '09:00', end_time: '17:00' },
			{ weekday: 3, start_time: '09:00', end_time: '12:00' },
			{ weekday: 3, start_time: '13:00', end_time: '18:00' },
		]);
	});

	it('returns no rules when every day is off', () => {
		expect(hoursToRules(week({}))).toEqual([]);
	});
});

describe('rulesToHours', () => {
	it('groups stored rules by weekday and trims seconds', () => {
		const hours = rulesToHours([
			{ weekday: 1, start_time: '13:00:00', end_time: '17:00:00' },
			{ weekday: 1, start_time: '09:00:00', end_time: '12:00:00' },
			{ weekday: 5, start_time: '10:00:00', end_time: '19:30:00' },
		]);
		expect(hours[1]).toEqual({
			weekday: 1,
			enabled: true,
			windows: [
				{ start: '09:00', end: '12:00' },
				{ start: '13:00', end: '17:00' },
			],
		});
		expect(hours[5]?.windows).toEqual([{ start: '10:00', end: '19:30' }]);
		expect(hours[0]).toEqual({
			weekday: 0,
			enabled: false,
			windows: [{ start: '09:00', end: '17:00' }],
		});
	});

	it('round-trips with hoursToRules', () => {
		const hours = week({
			2: [
				{ start: '09:00', end: '12:00' },
				{ start: '12:30', end: '17:00' },
			],
			6: [{ start: '08:00', end: '14:00' }],
		});
		expect(rulesToHours(hoursToRules(hours))).toEqual(hours);
	});
});

describe('validateDay', () => {
	it('allows split days and back-to-back windows', () => {
		expect(
			validateDay({
				weekday: 1,
				enabled: true,
				windows: [
					{ start: '09:00', end: '12:00' },
					{ start: '12:00', end: '17:00' },
				],
			}),
		).toBeNull();
	});

	it.each([
		[[], 'Add hours or turn this day off.'],
		[[{ start: '17:00', end: '09:00' }], 'Start must be before end.'],
		[[{ start: '09:00', end: '09:00' }], 'Start must be before end.'],
		[[{ start: '9:00', end: '17:00' }], 'Enter times as HH:MM.'],
		[
			[
				{ start: '09:00', end: '13:00' },
				{ start: '12:00', end: '17:00' },
			],
			'Time ranges overlap.',
		],
	])('rejects %j', (windows, message) => {
		expect(validateDay({ weekday: 1, enabled: true, windows })).toBe(message);
	});

	it('ignores windows on a day that is off', () => {
		expect(
			validateDay({ weekday: 1, enabled: false, windows: [{ start: '17:00', end: '09:00' }] }),
		).toBeNull();
	});
});

describe('weeklyHoursSchema', () => {
	it('accepts the defaults (Tue–Sat 9–5)', () => {
		const hours = defaultWeeklyHours();
		expect(weeklyHoursSchema.parse(hours)).toEqual(hours);
		expect(hoursToRules(hours).map((r) => r.weekday)).toEqual([2, 3, 4, 5, 6]);
	});

	it('reports the failing day by index', () => {
		const hours = week({ 4: [{ start: '18:00', end: '10:00' }] });
		const result = weeklyHoursSchema.safeParse(hours);
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.path).toEqual([4]);
	});

	it('requires all seven days in order', () => {
		expect(weeklyHoursSchema.safeParse(defaultWeeklyHours().slice(0, 6)).success).toBe(false);
		expect(weeklyHoursSchema.safeParse([...defaultWeeklyHours()].reverse()).success).toBe(false);
	});

	it('parses the JSON posted by the editor', () => {
		expect(weeklyHoursJsonSchema.parse(JSON.stringify(defaultWeeklyHours()))).toEqual(
			defaultWeeklyHours(),
		);
		expect(weeklyHoursJsonSchema.safeParse('{not json').success).toBe(false);
	});
});
