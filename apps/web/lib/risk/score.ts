import 'server-only';
import { getMlEnv, type MlEnv } from '@/lib/env';
import type { Json } from '@/lib/database.types';
import type { Db } from '@/lib/shop/settings';
import { instantFromIso, instantToIso, timeZone, type Instant } from '@/lib/time';
import { requestScore, type BookingRecordJson, type FetchLike, type ScoreRequest } from './client';
import { fairnessCapReached } from './fairness';
import { NO_PLAN, planRiskActions } from './plan';
import { RISK_SETTINGS_COLUMNS, toRiskSettings } from './settings';
import { isConfirmationStatus, type ConfirmationStatus, type RiskTier } from './types';

/** Booking-time scoring must never hold up the client; the job can afford to wait longer. */
export const BOOKING_TIMEOUT_MS = 300;
export const JOB_TIMEOUT_MS = 2_000;
const MAX_HISTORY = 500;
const BASE_RATE_WINDOW_DAYS = 365;

export type ScoreOutcome = 'scored' | 'failed' | 'skipped';

export interface ScoreOptions {
	now?: Instant;
	timeoutMs?: number;
	/** Score as of now (re-scoring) rather than as of when the booking was made. */
	rescore?: boolean;
	fetchImpl?: FetchLike;
	env?: MlEnv | null;
}

const BOOKING_FIELDS =
	'id, shop_id, client_id, created_at, starts_at, ends_at, status, source, price_cents, cancelled_at, client_confirmed_at, confirmation_status, release_reason';

type BookingFieldsRow = {
	id: string;
	shop_id: string;
	client_id: string;
	created_at: string;
	starts_at: string;
	ends_at: string;
	status: string;
	source: string;
	price_cents: number;
	cancelled_at: string | null;
	client_confirmed_at: string | null;
	confirmation_status: string;
	release_reason: string | null;
};

const RECORD_SOURCES: Record<string, BookingRecordJson['source']> = {
	phone: 'phone',
	walk_in: 'walk_in',
	import: 'import',
	demo: 'demo',
};
const RECORD_STATUSES = new Set(['pending', 'confirmed', 'completed', 'no_show', 'cancelled']);

export function toBookingRecord(row: BookingFieldsRow, timezone: string): BookingRecordJson {
	const status =
		row.status === 'cancelled' && row.release_reason
			? 'released'
			: RECORD_STATUSES.has(row.status)
				? (row.status as BookingRecordJson['status'])
				: 'confirmed';
	return {
		booking_id: row.id,
		shop_id: row.shop_id,
		client_id: row.client_id,
		created_at: instantToIso(instantFromIso(row.created_at)),
		starts_at: instantToIso(instantFromIso(row.starts_at)),
		status,
		shop_timezone: timezone,
		has_start_time: true,
		duration_minutes: Math.max(
			0,
			Math.round((instantFromIso(row.ends_at) - instantFromIso(row.starts_at)) / 60_000),
		),
		price_cents: row.price_cents,
		// Every booking-link source (instagram, google, waitlist…) is an online booking.
		source: RECORD_SOURCES[row.source] ?? 'direct',
		cancelled_at: row.cancelled_at ? instantToIso(instantFromIso(row.cancelled_at)) : null,
		confirm_requested: row.confirmation_status !== 'not_required',
		reminder_replied: row.client_confirmed_at !== null,
	};
}

async function shopStats(db: Db, shopId: string, now: Instant) {
	const since = instantToIso((now - BASE_RATE_WINDOW_DAYS * 86_400_000) as Instant);
	const count = (statuses: string[]) =>
		db
			.from('bookings')
			.select('id', { count: 'exact', head: true })
			.eq('shop_id', shopId)
			.in('status', statuses)
			.gte('starts_at', since)
			.lt('starts_at', instantToIso(now));
	const [labelled, noShows] = await Promise.all([
		count(['completed', 'no_show']),
		count(['no_show']),
	]);
	if (labelled.error) throw labelled.error;
	if (noShows.error) throw noShows.error;
	const total = labelled.count ?? 0;
	return { labelled: total, baseRate: total > 0 ? (noShows.count ?? 0) / total : null };
}

/**
 * Scores one booking and stores the result with its planned texts. Never throws: on any failure the
 * booking keeps working with tier "unknown" (or untouched if it could not even be loaded).
 * `db` must be the service-role client.
 */
export async function scoreBooking(
	db: Db,
	bookingId: string,
	options: ScoreOptions = {},
): Promise<ScoreOutcome> {
	const env = options.env === undefined ? getMlEnv() : options.env;
	if (!env) return 'skipped';
	const now = options.now ?? (Date.now() as Instant);

	try {
		const { data: booking, error } = await db
			.from('bookings')
			.select(
				`${BOOKING_FIELDS}, risk_trusted_at, shop:shops!bookings_shop_id_fkey(timezone, waitlist_min_notice_minutes, ${RISK_SETTINGS_COLUMNS})`,
			)
			.eq('id', bookingId)
			.maybeSingle();
		if (error) throw error;
		if (!booking || booking.status !== 'confirmed') return 'skipped';

		const settings = toRiskSettings(booking.shop);
		const [historyResult, stats] = await Promise.all([
			db
				.from('bookings')
				.select(BOOKING_FIELDS)
				.eq('shop_id', booking.shop_id)
				.eq('client_id', booking.client_id)
				.neq('id', booking.id)
				.order('starts_at', { ascending: false })
				.limit(MAX_HISTORY),
			shopStats(db, booking.shop_id, now),
		]);
		if (historyResult.error) throw historyResult.error;
		const history = historyResult.data;

		const body: ScoreRequest = {
			booking_id: booking.id,
			shop_id: booking.shop_id,
			booking: toBookingRecord(booking, booking.shop.timezone),
			history: history.map((h) => toBookingRecord(h, booking.shop.timezone)),
			shop: { base_rate: stats.baseRate, labelled_bookings: stats.labelled },
			thresholds: { medium: settings.mediumThreshold, high: settings.highThreshold },
			...(options.rescore ? { as_of: instantToIso(now) } : {}),
		};

		let score: {
			value: number | null;
			tier: RiskTier;
			method: 'model' | 'heuristic' | null;
			version: string | null;
			factors: string[];
		};
		try {
			const res = await requestScore(env, body, {
				timeoutMs: options.timeoutMs ?? BOOKING_TIMEOUT_MS,
				fetchImpl: options.fetchImpl,
			});
			score = {
				value: res.risk_score,
				tier: res.risk_score === null ? 'unknown' : res.tier,
				method: res.method,
				version: res.model_version,
				factors: res.top_factors,
			};
		} catch (scoreError) {
			console.warn('[risk] scoring %s failed: %s', bookingId, String(scoreError));
			score = { value: null, tier: 'unknown', method: null, version: null, factors: [] };
		}

		const confirmationStatus: ConfirmationStatus = isConfirmationStatus(booking.confirmation_status)
			? booking.confirmation_status
			: 'not_required';
		const plan =
			score.tier === 'unknown'
				? NO_PLAN
				: planRiskActions({
						tier: score.tier,
						settings,
						source: booking.source,
						trusted: booking.risk_trusted_at !== null,
						confirmationStatus,
						fairnessCapReached: fairnessCapReached(
							history.map((h) => ({
								status: h.status,
								confirmationStatus: h.confirmation_status,
								startsAtMs: instantFromIso(h.starts_at),
							})),
							settings.confirmCap,
							now,
						),
						startsAt: instantFromIso(booking.starts_at),
						now,
						timezone: timeZone(booking.shop.timezone),
						minNoticeMinutes: booking.shop.waitlist_min_notice_minutes,
					});

		const iso = (at: Instant | null) => (at === null ? undefined : instantToIso(at));
		const { error: applyError } = await db.rpc('apply_booking_risk', {
			p_booking_id: booking.id,
			p_starts_at: booking.starts_at,
			p_score: score.value ?? undefined,
			p_tier: score.tier,
			p_method: score.method ?? undefined,
			p_model_version: score.version ?? undefined,
			p_factors: score.factors as Json,
			p_confirm_request_at: iso(plan.confirmRequestAt),
			p_final_warning_at: iso(plan.finalWarningAt),
			p_extra_reminder_at: iso(plan.extraReminderAt),
			p_confirmation_due_at: iso(plan.confirmationDueAt),
		});
		if (applyError) throw applyError;
		return score.tier === 'unknown' ? 'failed' : 'scored';
	} catch (error) {
		console.error('[risk] could not store a score for %s: %o', bookingId, error);
		return 'failed';
	}
}
