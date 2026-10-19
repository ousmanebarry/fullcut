import { z } from 'zod';

export interface TimeWindow {
	start: string;
	end: string;
}

export interface DayHours {
	weekday: number;
	enabled: boolean;
	windows: TimeWindow[];
}

/** Seven entries, Sunday (0) … Saturday (6). */
export type WeeklyHours = DayHours[];

export type RuleInput = {
	weekday: number;
	start_time: string;
	end_time: string;
};

export interface StoredRule {
	weekday: number;
	start_time: string;
	end_time: string;
}

export const WEEKDAY_NAMES = [
	'Sunday',
	'Monday',
	'Tuesday',
	'Wednesday',
	'Thursday',
	'Friday',
	'Saturday',
] as const;
const DEFAULT_WINDOW: TimeWindow = { start: '09:00', end: '17:00' };
const HH_MM = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function toMinutes(time: string): number {
	return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

export function defaultWeeklyHours(): WeeklyHours {
	return WEEKDAY_NAMES.map((_, weekday) => ({
		weekday,
		enabled: weekday >= 2 && weekday <= 6,
		windows: [{ ...DEFAULT_WINDOW }],
	}));
}

/** Validates a day's windows; returns an error message or null. */
export function validateDay(day: DayHours): string | null {
	if (!day.enabled) return null;
	if (day.windows.length === 0) return 'Add hours or turn this day off.';
	if (day.windows.some((w) => !HH_MM.test(w.start) || !HH_MM.test(w.end)))
		return 'Enter times as HH:MM.';
	if (day.windows.some((w) => toMinutes(w.start) >= toMinutes(w.end)))
		return 'Start must be before end.';

	const sorted = [...day.windows].sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
	for (let i = 1; i < sorted.length; i++) {
		const previous = sorted[i - 1];
		const current = sorted[i];
		if (previous && current && toMinutes(current.start) < toMinutes(previous.end)) {
			return 'Time ranges overlap.';
		}
	}
	return null;
}

/** Enabled days become one rule per window, sorted by weekday then start. */
export function hoursToRules(hours: WeeklyHours): RuleInput[] {
	return hours
		.filter((day) => day.enabled)
		.flatMap((day) =>
			day.windows.map((w) => ({ weekday: day.weekday, start_time: w.start, end_time: w.end })),
		)
		.sort((a, b) => a.weekday - b.weekday || toMinutes(a.start_time) - toMinutes(b.start_time));
}

export function rulesToHours(rules: readonly StoredRule[]): WeeklyHours {
	return WEEKDAY_NAMES.map((_, weekday) => {
		const windows = rules
			.filter((rule) => rule.weekday === weekday)
			.map((rule) => ({ start: rule.start_time.slice(0, 5), end: rule.end_time.slice(0, 5) }))
			.sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
		return windows.length > 0
			? { weekday, enabled: true, windows }
			: { weekday, enabled: false, windows: [{ ...DEFAULT_WINDOW }] };
	});
}

const windowSchema = z.object({ start: z.string(), end: z.string() });
const daySchema = z.object({
	weekday: z.number().int().min(0).max(6),
	enabled: z.boolean(),
	windows: z.array(windowSchema).max(6),
});

export const weeklyHoursSchema = z
	.array(daySchema)
	.length(7)
	.superRefine((days, ctx) => {
		days.forEach((day, index) => {
			if (day.weekday !== index) {
				ctx.addIssue({ code: 'custom', path: [index], message: 'Days are out of order.' });
				return;
			}
			const message = validateDay(day);
			if (message) ctx.addIssue({ code: 'custom', path: [index], message });
		});
	});

/** Parses the JSON an hours editor posts in a hidden field. */
export const weeklyHoursJsonSchema = z
	.string()
	.transform((value, ctx) => {
		try {
			return JSON.parse(value) as unknown;
		} catch {
			ctx.addIssue({ code: 'custom', message: 'Hours could not be read.' });
			return z.NEVER;
		}
	})
	.pipe(weeklyHoursSchema);
