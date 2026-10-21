import 'server-only';
import { z } from 'zod';
import type { MlEnv } from '@/lib/env';

/** BookingRecord as the scoring service expects it (services/ml/fullcut_ml/schema.py). */
export interface BookingRecordJson {
	booking_id: string;
	shop_id: string;
	client_id: string;
	created_at: string;
	starts_at: string;
	status: 'pending' | 'confirmed' | 'completed' | 'no_show' | 'cancelled' | 'released';
	shop_timezone: string;
	has_start_time: true;
	duration_minutes: number;
	price_cents: number;
	source: 'direct' | 'phone' | 'walk_in' | 'import' | 'demo' | 'unknown';
	cancelled_at: string | null;
	confirm_requested: boolean;
	reminder_replied: boolean;
}

export interface ScoreRequest {
	booking_id: string;
	shop_id: string;
	booking: BookingRecordJson;
	history: BookingRecordJson[];
	shop: { base_rate: number | null; labelled_bookings: number };
	thresholds: { medium: number; high: number };
	as_of?: string;
}

const scoreResponseSchema = z.object({
	booking_id: z.string(),
	risk_score: z.number().min(0).max(1).nullable(),
	tier: z.enum(['low', 'medium', 'high', 'unknown']),
	method: z.enum(['model', 'heuristic']),
	model_version: z.string().min(1).max(64),
	top_factors: z.array(z.string().max(120)).max(5),
});

export type ScoreResponse = z.infer<typeof scoreResponseSchema>;

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** One call to POST /score. Throws on timeout, HTTP errors and malformed responses. */
export async function requestScore(
	env: MlEnv,
	body: ScoreRequest,
	options: { timeoutMs: number; fetchImpl?: FetchLike },
): Promise<ScoreResponse> {
	const res = await (options.fetchImpl ?? fetch)(new URL('/score', env.url).toString(), {
		method: 'POST',
		headers: { 'content-type': 'application/json', authorization: `Bearer ${env.secret}` },
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(options.timeoutMs),
		cache: 'no-store',
	});
	if (!res.ok) throw new Error(`scoring service returned ${res.status}`);
	const parsed = scoreResponseSchema.parse(await res.json());
	if (parsed.booking_id !== body.booking_id)
		throw new Error('scoring service answered another booking');
	return parsed;
}
