import 'server-only';
import { after } from 'next/server';
import { getMlEnv } from '@/lib/env';
import type { Db } from '@/lib/shop/settings';
import type { Instant } from '@/lib/time';
import { JOB_TIMEOUT_MS, scoreBooking } from './score';
import type { FetchLike } from './client';

const SCORE_BATCH = 25;
const DEADLINE_BATCH = 50;

export interface RiskBatchOptions {
	clock?: () => Instant;
	budgetMs?: number;
	fetchImpl?: FetchLike;
}

export interface RiskCounts {
	released: number;
	flagged: number;
	scored: number;
	failed: number;
}

/**
 * Confirmation deadlines first (a release queues the freed slot for the waitlist step that follows),
 * then scoring of upcoming bookings that were never scored or are entering their last 48 hours.
 * `db` must be the service-role client.
 */
export async function runRiskBatch(db: Db, options: RiskBatchOptions = {}): Promise<RiskCounts> {
	const clock = options.clock ?? (() => Date.now() as Instant);
	const deadline = clock() + (options.budgetMs ?? 10_000);
	const counts: RiskCounts = { released: 0, flagged: 0, scored: 0, failed: 0 };

	const due = await db.rpc('process_confirmation_deadlines', { p_limit: DEADLINE_BATCH });
	if (due.error) throw due.error;
	for (const row of due.data) counts[row.outcome === 'released' ? 'released' : 'flagged']++;

	const env = getMlEnv();
	if (!env) return counts;
	const { data, error } = await db.rpc('bookings_due_for_scoring', { p_limit: SCORE_BATCH });
	if (error) throw error;
	for (const { booking_id } of data) {
		if (clock() >= deadline) break;
		const outcome = await scoreBooking(db, booking_id, {
			env,
			now: clock(),
			rescore: true,
			timeoutMs: JOB_TIMEOUT_MS,
			fetchImpl: options.fetchImpl,
		});
		if (outcome === 'scored') counts.scored++;
		else if (outcome === 'failed') counts.failed++;
	}
	return counts;
}

/**
 * Scores a booking after the response has been sent, so the client never waits on it. A no-op when
 * scoring is not configured. `db` must be the service-role client.
 */
export function scoreAfterResponse(db: Db, bookingId: string, rescore = false): void {
	if (!getMlEnv()) return;
	after(async () => {
		await scoreBooking(db, bookingId, { rescore });
	});
}
