// Client-safe waitlist types and limits (no Luxon, no zod).

export const ENTRY_STATUSES = ['active', 'booked', 'expired', 'cancelled'] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

export const MAX_TIME_WINDOWS = 14;
export const MAX_ACTIVE_ENTRIES_PER_PHONE = 3;

/** Shop-local weekday (0 = Sunday) and wall-clock range, `HH:MM`. A type alias so it is assignable to Json. */
export type TimeWindow = {
	weekday: number;
	start: string;
	end: string;
};

export const TIME_OF_DAY_PRESETS = [
	{ id: 'morning', label: 'Morning', start: '09:00', end: '12:00' },
	{ id: 'afternoon', label: 'Afternoon', start: '12:00', end: '17:00' },
	{ id: 'evening', label: 'Evening', start: '17:00', end: '21:00' },
] as const;

export const WEEKDAY_LABELS = [
	'Sunday',
	'Monday',
	'Tuesday',
	'Wednesday',
	'Thursday',
	'Friday',
	'Saturday',
] as const;

/** Windows as stored in jsonb; anything malformed is dropped. */
export function parseWindows(value: unknown): TimeWindow[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((w: unknown) => {
		if (!w || typeof w !== 'object') return [];
		const { weekday, start, end } = w as Record<string, unknown>;
		return typeof weekday === 'number' && typeof start === 'string' && typeof end === 'string'
			? [{ weekday, start, end }]
			: [];
	});
}

/** "Any time", or the windows as short text, e.g. "Tue 09:00-12:00". */
export function describeWindows(windows: readonly TimeWindow[]): string {
	if (windows.length === 0) return 'Any time';
	return windows
		.map((w) => `${WEEKDAY_LABELS[w.weekday]?.slice(0, 3) ?? '?'} ${w.start}-${w.end}`)
		.join(', ');
}

/**
 * Windows for the chosen weekdays and times of day. Choosing neither means any time; choosing only
 * one side means every weekday, or the whole day. Adjacent times of day merge into one range.
 */
export function buildWindows(
	weekdays: readonly number[],
	presetIds: readonly string[],
): TimeWindow[] {
	if (weekdays.length === 0 && presetIds.length === 0) return [];
	const days = weekdays.length > 0 ? [...weekdays].sort((a, b) => a - b) : [0, 1, 2, 3, 4, 5, 6];
	const chosen = TIME_OF_DAY_PRESETS.filter((p) => presetIds.includes(p.id));
	const ranges: { start: string; end: string }[] = [];
	for (const preset of chosen.length > 0 ? chosen : [{ start: '00:00', end: '23:59' }]) {
		const last = ranges.at(-1);
		if (last && last.end === preset.start) last.end = preset.end;
		else ranges.push({ start: preset.start, end: preset.end });
	}
	return days.flatMap((weekday) => ranges.map((r) => ({ weekday, ...r })));
}
