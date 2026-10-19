// Positions bookings, closed hours and time off on a wall-clock grid. Rows are shop-local wall-clock
// minutes so 9:00 lines up across days; block heights are real elapsed time, so DST days stay correct.
import type { AvailabilityRule, TimeOff } from '@/lib/booking/types';
import {
	localMinuteOfDay,
	parseLocalTime,
	weekdayOf,
	zonedToInstant,
	type Instant,
	type LocalDate,
	type TimeZone,
} from '@/lib/time';

const DAY_MINUTES = 1440;
const DEFAULT_START = 8 * 60;
const DEFAULT_END = 20 * 60;
const MS_PER_MINUTE = 60_000;

export interface LayoutBooking {
	id: string;
	staffId: string;
	startsAt: Instant;
	endsAt: Instant;
	blockedUntil: Instant;
}

export interface LayoutBlock {
	bookingId: string;
	topMin: number;
	heightMin: number;
	bufferMin: number;
	lane: number;
	lanes: number;
}

export interface LayoutShade {
	topMin: number;
	heightMin: number;
	kind: 'closed' | 'time_off';
}

export interface LayoutColumnInput {
	key: string;
	staffId: string;
	date: LocalDate;
	title: string;
}

export interface LayoutColumn extends LayoutColumnInput {
	blocks: LayoutBlock[];
	shades: LayoutShade[];
}

export interface CalendarLayout {
	startMin: number;
	endMin: number;
	hours: { minute: number; label: string }[];
	columns: LayoutColumn[];
}

export interface LayoutInput {
	zone: TimeZone;
	columns: readonly LayoutColumnInput[];
	bookings: readonly LayoutBooking[];
	rules: readonly AvailabilityRule[];
	timeOff: readonly TimeOff[];
}

interface Span {
	start: number;
	end: number;
}

export function buildCalendarLayout(input: LayoutInput): CalendarLayout {
	const columns = input.columns.map((column) => layoutColumn(column, input));

	const open = columns.flatMap((c) => openSpans(c, input.rules));
	const used = columns.flatMap((c) =>
		c.blocks.map((b) => ({ start: b.topMin, end: b.topMin + b.heightMin + b.bufferMin })),
	);
	const spans = [...open, ...used];
	let startMin = spans.length ? Math.min(...spans.map((s) => s.start)) : DEFAULT_START;
	let endMin = spans.length ? Math.max(...spans.map((s) => s.end)) : DEFAULT_END;
	startMin = Math.floor(startMin / 60) * 60;
	endMin = Math.min(DAY_MINUTES, Math.max(startMin + 60, Math.ceil(endMin / 60) * 60));

	const hours = [];
	for (let minute = startMin; minute < endMin; minute += 60) {
		hours.push({ minute, label: hourLabel(minute) });
	}
	return { startMin, endMin, hours, columns };
}

function layoutColumn(column: LayoutColumnInput, input: LayoutInput): LayoutColumn {
	const dayStart = zonedToInstant(column.date, 0, input.zone);
	const dayEnd = zonedToInstant(column.date, DAY_MINUTES, input.zone);
	const toMinute = (instant: Instant) => {
		if (instant <= dayStart) return 0;
		if (instant >= dayEnd) return DAY_MINUTES;
		return localMinuteOfDay(instant, input.zone);
	};
	const clip = (instant: Instant) => Math.min(Math.max(instant, dayStart), dayEnd);

	const blocks = input.bookings
		.filter((b) => b.staffId === column.staffId && b.startsAt < dayEnd && b.blockedUntil > dayStart)
		.toSorted((a, b) => a.startsAt - b.startsAt)
		.map((b) => {
			const topMin = toMinute(b.startsAt);
			const room = DAY_MINUTES - topMin;
			const heightMin = Math.min(room, (clip(b.endsAt) - clip(b.startsAt)) / MS_PER_MINUTE);
			const bufferMin = Math.min(
				room - heightMin,
				(clip(b.blockedUntil) - clip(b.endsAt)) / MS_PER_MINUTE,
			);
			return { bookingId: b.id, topMin, heightMin, bufferMin, lane: 0, lanes: 1 };
		});
	assignLanes(blocks);

	const open = openSpans(column, input.rules);
	const shades: LayoutShade[] = [
		...complement(open).map((s) => shade(s, 'closed')),
		...input.timeOff
			.filter((t) => t.staffId === column.staffId && t.startsAt < dayEnd && t.endsAt > dayStart)
			.map((t) => shade({ start: toMinute(t.startsAt), end: toMinute(t.endsAt) }, 'time_off')),
	].filter((s) => s.heightMin > 0);

	return { ...column, blocks, shades };
}

function openSpans(column: LayoutColumnInput, rules: readonly AvailabilityRule[]): Span[] {
	const weekday = weekdayOf(column.date);
	return mergeSpans(
		rules
			.filter((r) => r.staffId === column.staffId && r.weekday === weekday)
			.map((r) => ({ start: parseLocalTime(r.startTime), end: parseLocalTime(r.endTime) })),
	);
}

function mergeSpans(spans: Span[]): Span[] {
	const merged: Span[] = [];
	for (const span of spans.toSorted((a, b) => a.start - b.start)) {
		const last = merged.at(-1);
		if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
		else merged.push({ ...span });
	}
	return merged;
}

function complement(open: Span[]): Span[] {
	const closed: Span[] = [];
	let cursor = 0;
	for (const span of open) {
		if (span.start > cursor) closed.push({ start: cursor, end: span.start });
		cursor = Math.max(cursor, span.end);
	}
	if (cursor < DAY_MINUTES) closed.push({ start: cursor, end: DAY_MINUTES });
	return closed;
}

function shade(span: Span, kind: LayoutShade['kind']): LayoutShade {
	return { topMin: span.start, heightMin: span.end - span.start, kind };
}

// Overlap only happens with inactive statuses (e.g. a no-show under a later walk-in); split the width.
function assignLanes(blocks: LayoutBlock[]): void {
	let cluster: LayoutBlock[] = [];
	let clusterEnd = -1;
	const laneEnds: number[] = [];
	const close = () => {
		const lanes = Math.max(1, laneEnds.length);
		for (const block of cluster) block.lanes = lanes;
		cluster = [];
		laneEnds.length = 0;
	};
	for (const block of blocks) {
		const end = block.topMin + Math.max(block.heightMin, 1);
		if (block.topMin >= clusterEnd) close();
		let lane = laneEnds.findIndex((laneEnd) => laneEnd <= block.topMin);
		if (lane === -1) lane = laneEnds.length;
		laneEnds[lane] = end;
		block.lane = lane;
		cluster.push(block);
		clusterEnd = Math.max(clusterEnd, end);
	}
	close();
}

export function hourLabel(minute: number): string {
	const hour = Math.floor(minute / 60) % 24;
	const suffix = hour < 12 ? 'AM' : 'PM';
	return `${hour % 12 === 0 ? 12 : hour % 12} ${suffix}`;
}
