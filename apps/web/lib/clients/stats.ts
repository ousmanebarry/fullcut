// Pure client statistics; no I/O, no Luxon.

const DAY_MS = 24 * 60 * 60 * 1000;
const USUAL_WINDOW = 10;

/** Median whole days between consecutive visits, or null with fewer than two visits. */
export function medianIntervalDays(visitStartsMs: readonly number[]): number | null {
	if (visitStartsMs.length < 2) return null;
	const sorted = [...visitStartsMs].sort((a, b) => a - b);
	const gaps = sorted
		.slice(1)
		.map((start, i) => (start - (sorted[i] as number)) / DAY_MS)
		.sort((a, b) => a - b);
	const mid = Math.floor(gaps.length / 2);
	const median =
		gaps.length % 2 === 1
			? (gaps[mid] as number)
			: ((gaps[mid - 1] as number) + (gaps[mid] as number)) / 2;
	return Math.round(median);
}

export interface VisitForUsual {
	status: string;
	startsAtMs: number;
	serviceId: string;
	staffId: string;
}

/** Most frequent of `values` (ordered most recent first); ties go to the most recent. */
function mostFrequent(values: readonly string[]): string | null {
	const counts = new Map<string, number>();
	for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
	let best: string | null = null;
	let bestCount = 0;
	for (const value of values) {
		const count = counts.get(value) ?? 0;
		if (count > bestCount) {
			best = value;
			bestCount = count;
		}
	}
	return best;
}

/**
 * The service and staff member a client usually books, from their latest completed visits
 * (or any non-cancelled booking if they have none). Inactive choices are skipped.
 */
export function usualBooking(
	history: readonly VisitForUsual[],
	active: { serviceIds: ReadonlySet<string>; staffIds: ReadonlySet<string> },
): { serviceId: string | null; staffId: string | null } {
	const recentFirst = [...history].sort((a, b) => b.startsAtMs - a.startsAtMs);
	const completed = recentFirst.filter((b) => b.status === 'completed');
	const pool = (
		completed.length > 0 ? completed : recentFirst.filter((b) => b.status !== 'cancelled')
	).slice(0, USUAL_WINDOW);
	return {
		serviceId: mostFrequent(pool.map((b) => b.serviceId).filter((id) => active.serviceIds.has(id))),
		staffId: mostFrequent(pool.map((b) => b.staffId).filter((id) => active.staffIds.has(id))),
	};
}
