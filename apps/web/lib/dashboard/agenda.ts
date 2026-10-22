// A phone-friendly list view of one calendar column: bookings, time off and the free gaps between them.
import type { LayoutColumn } from './calendar-layout';

const DAY_MINUTES = 1440;
const MIN_FREE_MINUTES = 15;

export type AgendaItem =
	| { kind: 'booking'; bookingId: string; startMin: number; endMin: number }
	| { kind: 'time_off'; startMin: number; endMin: number }
	| { kind: 'free'; startMin: number; endMin: number };

interface Span {
	start: number;
	end: number;
}

/** Free gaps start no earlier than `notBeforeMin` (e.g. now, on today's date; 1440 for past days). */
export function buildAgenda(column: LayoutColumn, notBeforeMin = 0): AgendaItem[] {
	const closed = column.shades.filter((s) => s.kind === 'closed').map(toSpan);
	const timeOff = column.shades.filter((s) => s.kind === 'time_off').map(toSpan);
	const busy = [
		...column.blocks.map((b) => ({ start: b.topMin, end: b.topMin + b.heightMin + b.bufferMin })),
		...timeOff,
	];

	const free = subtract(subtract([{ start: 0, end: DAY_MINUTES }], closed), busy)
		.map((s) => ({ start: Math.max(s.start, roundUp(notBeforeMin, 5)), end: s.end }))
		.filter((s) => s.end - s.start >= MIN_FREE_MINUTES);

	const items: AgendaItem[] = [
		...column.blocks.map((b): AgendaItem => ({
			kind: 'booking',
			bookingId: b.bookingId,
			startMin: b.topMin,
			endMin: b.topMin + b.heightMin,
		})),
		...timeOff.map((s): AgendaItem => ({ kind: 'time_off', startMin: s.start, endMin: s.end })),
		...free.map((s): AgendaItem => ({ kind: 'free', startMin: s.start, endMin: s.end })),
	];
	const order = { booking: 0, time_off: 1, free: 2 };
	return items.toSorted((a, b) => a.startMin - b.startMin || order[a.kind] - order[b.kind]);
}

/** True when the column has no working hours at all that day. */
export function isClosedAllDay(column: LayoutColumn): boolean {
	const closed = column.shades.filter((s) => s.kind === 'closed').map(toSpan);
	return subtract([{ start: 0, end: DAY_MINUTES }], closed).length === 0;
}

export function minuteLabel(minute: number): string {
	const hour = Math.floor(minute / 60) % 24;
	const min = minute % 60;
	const suffix = hour < 12 ? 'AM' : 'PM';
	return `${hour % 12 === 0 ? 12 : hour % 12}:${String(min).padStart(2, '0')} ${suffix}`;
}

function toSpan(shade: { topMin: number; heightMin: number }): Span {
	return { start: shade.topMin, end: shade.topMin + shade.heightMin };
}

function roundUp(value: number, step: number): number {
	return Math.ceil(value / step) * step;
}

function subtract(spans: Span[], cuts: Span[]): Span[] {
	let result = spans;
	for (const cut of cuts) {
		result = result.flatMap((s) => {
			if (cut.end <= s.start || cut.start >= s.end) return [s];
			const parts: Span[] = [];
			if (cut.start > s.start) parts.push({ start: s.start, end: cut.start });
			if (cut.end < s.end) parts.push({ start: cut.end, end: s.end });
			return parts;
		});
	}
	return result;
}
