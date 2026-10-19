import type { Instant } from '@/lib/time';

/** Half-open `[start, end)`; back-to-back intervals touch but do not overlap. */
export interface Interval {
	start: Instant;
	end: Instant;
}

export function mergeIntervals(intervals: readonly Interval[]): Interval[] {
	const sorted = intervals.filter((i) => i.start < i.end).sort((a, b) => a.start - b.start);
	const merged: Interval[] = [];
	for (const next of sorted) {
		const last = merged.at(-1);
		if (last && next.start <= last.end) {
			if (next.end > last.end) last.end = next.end;
		} else {
			merged.push({ start: next.start, end: next.end });
		}
	}
	return merged;
}

export function subtractIntervals(
	base: readonly Interval[],
	cuts: readonly Interval[],
): Interval[] {
	const mergedCuts = mergeIntervals(cuts);
	const result: Interval[] = [];
	for (const { start, end } of mergeIntervals(base)) {
		let cursor = start;
		for (const cut of mergedCuts) {
			if (cut.end <= cursor) continue;
			if (cut.start >= end) break;
			if (cut.start > cursor) result.push({ start: cursor, end: cut.start });
			cursor = cut.end;
			if (cursor >= end) break;
		}
		if (cursor < end) result.push({ start: cursor, end });
	}
	return result;
}

export function intersectIntervals(a: readonly Interval[], b: readonly Interval[]): Interval[] {
	const left = mergeIntervals(a);
	const right = mergeIntervals(b);
	const result: Interval[] = [];
	let i = 0;
	let j = 0;
	while (i < left.length && j < right.length) {
		const l = left[i] as Interval;
		const r = right[j] as Interval;
		const start = Math.max(l.start, r.start) as Instant;
		const end = Math.min(l.end, r.end) as Instant;
		if (start < end) result.push({ start, end });
		if (l.end < r.end) i++;
		else j++;
	}
	return result;
}

export function containsInterval(outer: Interval, inner: Interval): boolean {
	return outer.start <= inner.start && inner.end <= outer.end;
}
