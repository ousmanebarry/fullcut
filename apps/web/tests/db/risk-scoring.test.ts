import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POST as confirmRoute } from '@/app/api/manage/confirm/route';
import { handleInbound } from '@/lib/messaging/inbound';
import { hashToken, issueToken } from '@/lib/public-booking/links';
import type { FetchLike, ScoreRequest } from '@/lib/risk/client';
import { runRiskBatch } from '@/lib/risk/jobs';
import { scoreBooking } from '@/lib/risk/score';
import type { Db } from '@/lib/shop/settings';
import { createAdminClient } from '@/lib/supabase/admin';
import {
	instantToIso,
	localDateOf,
	plusDays,
	timeZone,
	zonedToInstant,
	type Instant,
} from '@/lib/time';
import { dbUrl, useLocalSupabaseEnv } from './local-supabase';

// Scoring a booking through a fake ML service, the stored plan, and confirmations, against the local stack.

const zone = timeZone('America/Toronto');
const ML_ENV = { url: 'http://ml.test', secret: 's'.repeat(40) };

const id = {
	shop: randomUUID(),
	quietShop: randomUUID(),
	staff: randomUUID(),
	quietStaff: randomUUID(),
	service: randomUUID(),
	quietService: randomUUID(),
};

const pool = new pg.Client({ connectionString: dbUrl });
let db: Db;

let phoneCounter = 0;
// +1 647 555 04xx: valid for libphonenumber, distinct from the other suites' numbers.
const nextPhone = () => `+164755504${String(phoneCounter++).padStart(2, '0')}`;
let dayCounter = 4;
/** 15:00 local on a fresh day, so the whole confirmation timeline falls outside quiet hours. */
const nextStart = () =>
	zonedToInstant(plusDays(localDateOf(Date.now() as Instant, zone), dayCounter++), 15 * 60, zone);

async function addClient(shop = id.shop): Promise<{ id: string; phone: string }> {
	const phone = nextPhone();
	const { rows } = await pool.query<{ id: string }>(
		`insert into public.clients (shop_id, name, phone_e164) values ($1, 'Risky Client', $2) returning id`,
		[shop, phone],
	);
	return { id: rows[0]?.id ?? '', phone };
}

async function addBooking(
	clientId: string,
	startsAt: Instant,
	opts: {
		shop?: string;
		staff?: string;
		service?: string;
		status?: string;
		confirmation?: string;
	} = {},
): Promise<string> {
	const { rows } = await pool.query<{ id: string }>(
		`insert into public.bookings (shop_id, staff_id, client_id, service_id, starts_at, ends_at, blocked_until, status, price_cents, confirmation_status, created_at)
		 values ($1, $2, $3, $4, $5, $5::timestamptz + interval '30 minutes', $5::timestamptz + interval '30 minutes', $6, 3000, $7,
		   least(now(), $5::timestamptz - interval '10 days'))
		 returning id`,
		[
			opts.shop ?? id.shop,
			opts.staff ?? id.staff,
			clientId,
			opts.service ?? id.service,
			instantToIso(startsAt),
			opts.status ?? 'confirmed',
			opts.confirmation ?? 'not_required',
		],
	);
	return rows[0]?.id ?? '';
}

async function booking(bookingId: string) {
	const { rows } = await pool.query<{
		status: string;
		risk_score: number | null;
		risk_tier: string | null;
		risk_method: string | null;
		risk_factors: string[] | null;
		confirmation_status: string;
		confirmation_due_at: Date | null;
	}>(
		'select status, risk_score, risk_tier, risk_method, risk_factors, confirmation_status, confirmation_due_at from public.bookings where id = $1',
		[bookingId],
	);
	return rows[0];
}

async function queuedTypes(bookingId: string): Promise<string[]> {
	const { rows } = await pool.query<{ type: string }>(
		`select type from public.scheduled_messages where booking_id = $1 and status = 'queued' order by type`,
		[bookingId],
	);
	return rows.map((r) => r.type);
}

function fakeService(answer: { tier?: string; risk_score?: number | null } | 'hang' = {}) {
	const calls: { url: string; headers: Headers; body: ScoreRequest }[] = [];
	const fetchImpl: FetchLike = async (url, init) => {
		const body = JSON.parse(String(init.body)) as ScoreRequest;
		calls.push({ url, headers: new Headers(init.headers), body });
		if (answer === 'hang') {
			return new Promise<Response>((_, reject) =>
				init.signal?.addEventListener('abort', () => reject(init.signal?.reason)),
			);
		}
		return Response.json({
			booking_id: body.booking_id,
			risk_score: 0.62,
			tier: 'high',
			method: 'heuristic',
			model_version: 'heuristic-1',
			top_factors: ['3 no-shows in last 4 visits', 'Booked 2 weeks ahead'],
			...answer,
		});
	};
	return { calls, fetchImpl };
}

describe('risk scoring', () => {
	beforeAll(async () => {
		useLocalSupabaseEnv();
		delete process.env.ML_SERVICE_URL;
		delete process.env.ML_SHARED_SECRET;
		db = createAdminClient();
		await pool.connect();
		await pool.query(
			`insert into public.shops (id, name, slug, timezone, risk_actions_enabled) values
			   ($1, 'Risk Shop', $3, 'America/Toronto', true), ($2, 'Quiet Shop', $4, 'America/Toronto', false)`,
			[
				id.shop,
				id.quietShop,
				`risk-${id.shop.slice(0, 8)}`,
				`risk-quiet-${id.quietShop.slice(0, 8)}`,
			],
		);
		await pool.query(
			`insert into public.staff (id, shop_id, display_name) values ($1, $3, 'Sam'), ($2, $4, 'Noor')`,
			[id.staff, id.quietStaff, id.shop, id.quietShop],
		);
		await pool.query(
			`insert into public.services (id, shop_id, name, duration_minutes, price_cents) values
			   ($1, $3, 'Skin Fade', 30, 3000), ($2, $4, 'Skin Fade', 30, 3000)`,
			[id.service, id.quietService, id.shop, id.quietShop],
		);
	});

	afterAll(async () => {
		await pool.query('delete from public.shops where id = any($1)', [[id.shop, id.quietShop]]);
		await pool.end();
	});

	it('does nothing when the scoring service is not configured', async () => {
		const client = await addClient();
		const bookingId = await addBooking(client.id, nextStart());
		expect(await scoreBooking(db, bookingId, { env: null })).toBe('skipped');
		expect((await booking(bookingId))?.risk_tier).toBeNull();
	});

	it('sends the client history, stores the score and queues the confirmation timeline', async () => {
		const client = await addClient();
		const past = nextStart();
		await addBooking(client.id, (past - 60 * 86_400_000) as Instant, { status: 'no_show' });
		await addBooking(client.id, (past - 30 * 86_400_000) as Instant, { status: 'completed' });
		const bookingId = await addBooking(client.id, nextStart());
		const service = fakeService();

		expect(await scoreBooking(db, bookingId, { env: ML_ENV, fetchImpl: service.fetchImpl })).toBe(
			'scored',
		);

		const [call] = service.calls;
		expect(call?.url).toBe('http://ml.test/score');
		expect(call?.headers.get('authorization')).toBe(`Bearer ${ML_ENV.secret}`);
		expect(call?.body.booking.booking_id).toBe(bookingId);
		expect(call?.body.history.map((h) => h.status).sort()).toEqual(['completed', 'no_show']);
		expect(call?.body.thresholds).toEqual({ medium: 0.15, high: 0.35 });
		expect(Object.keys(call?.body.booking ?? {})).not.toContain('name');

		expect(await booking(bookingId)).toMatchObject({
			status: 'confirmed',
			risk_tier: 'high',
			risk_method: 'heuristic',
			risk_factors: ['3 no-shows in last 4 visits', 'Booked 2 weeks ahead'],
			confirmation_status: 'requested',
		});
		expect((await booking(bookingId))?.confirmation_due_at).not.toBeNull();
		expect(await queuedTypes(bookingId)).toEqual(
			expect.arrayContaining(['confirm_request', 'extra_reminder', 'final_warning']),
		);
	});

	it('a slow or failing service never affects the booking', async () => {
		const client = await addClient();
		const bookingId = await addBooking(client.id, nextStart());
		const started = Date.now();
		expect(
			await scoreBooking(db, bookingId, {
				env: ML_ENV,
				fetchImpl: fakeService('hang').fetchImpl,
				timeoutMs: 300,
			}),
		).toBe('failed');
		expect(Date.now() - started).toBeLessThan(2_000);
		expect(await booking(bookingId)).toMatchObject({
			status: 'confirmed',
			risk_score: null,
			risk_tier: 'unknown',
			confirmation_status: 'not_required',
		});
		expect(await queuedTypes(bookingId)).not.toContain('confirm_request');
	});

	it('respects the owner trusting the client', async () => {
		const client = await addClient();
		const bookingId = await addBooking(client.id, nextStart());
		await pool.query('update public.bookings set risk_trusted_at = now() where id = $1', [
			bookingId,
		]);
		await scoreBooking(db, bookingId, { env: ML_ENV, fetchImpl: fakeService().fetchImpl });
		expect((await booking(bookingId))?.confirmation_status).toBe('not_required');
		const queued = await queuedTypes(bookingId);
		expect(queued).not.toContain('confirm_request');
		expect(queued).not.toContain('extra_reminder');
	});

	it('stops asking a client who confirmed and came three times in a row', async () => {
		const client = await addClient();
		const start = nextStart();
		for (const daysAgo of [90, 60, 30]) {
			await addBooking(client.id, (start - daysAgo * 86_400_000) as Instant, {
				status: 'completed',
				confirmation: 'confirmed',
			});
		}
		const bookingId = await addBooking(client.id, start);
		await scoreBooking(db, bookingId, { env: ML_ENV, fetchImpl: fakeService().fetchImpl });
		expect((await booking(bookingId))?.confirmation_status).toBe('not_required');
		const queued = await queuedTypes(bookingId);
		expect(queued).not.toContain('confirm_request');
		expect(queued).toContain('extra_reminder');
	});

	it('with automated actions off, a high score changes nothing but the badge', async () => {
		const client = await addClient(id.quietShop);
		const bookingId = await addBooking(client.id, nextStart(), {
			shop: id.quietShop,
			staff: id.quietStaff,
			service: id.quietService,
		});
		const before = await queuedTypes(bookingId);
		await scoreBooking(db, bookingId, { env: ML_ENV, fetchImpl: fakeService().fetchImpl });
		expect((await booking(bookingId))?.risk_tier).toBe('high');
		expect((await booking(bookingId))?.confirmation_status).toBe('not_required');
		expect(await queuedTypes(bookingId)).toEqual(before);
	});

	it('YES by text and "I\'m coming" on the manage page both confirm', async () => {
		const byText = await addClient();
		const textBooking = await addBooking(byText.id, nextStart(), { confirmation: 'requested' });
		await handleInbound(
			db,
			{ sid: `SM${randomBytes(16).toString('hex')}`, from: byText.phone, body: 'Yes' },
			Date.now() as Instant,
		);
		expect((await booking(textBooking))?.confirmation_status).toBe('confirmed');

		const byLink = await addClient();
		const linkBooking = await addBooking(byLink.id, nextStart(), { confirmation: 'unconfirmed' });
		const token = issueToken();
		await pool.query(
			`insert into public.booking_links (shop_id, booking_id, token_hash, expires_at) values ($1, $2, $3, now() + interval '30 days')`,
			[id.shop, linkBooking, hashToken(token)],
		);
		const res = await confirmRoute(
			new Request('http://localhost/api/manage/confirm', {
				method: 'POST',
				body: JSON.stringify({ token }),
				headers: { 'content-type': 'application/json' },
			}),
		);
		expect(res.status).toBe(200);
		expect((await booking(linkBooking))?.confirmation_status).toBe('confirmed');
	});

	it('the job flags a booking whose deadline passed without a final warning', async () => {
		const client = await addClient();
		const bookingId = await addBooking(client.id, nextStart(), { confirmation: 'requested' });
		await pool.query(`update public.shops set risk_auto_release = true where id = $1`, [id.shop]);
		await pool.query(
			`update public.bookings set confirmation_due_at = now() - interval '1 minute' where id = $1`,
			[bookingId],
		);
		const counts = await runRiskBatch(db);
		expect(counts.flagged).toBeGreaterThanOrEqual(1);
		expect(await booking(bookingId)).toMatchObject({
			status: 'confirmed',
			confirmation_status: 'unconfirmed',
		});
	});
});
