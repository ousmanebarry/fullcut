import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POST as cancelRoute } from '@/app/api/manage/cancel/route';
import { POST as rescheduleRoute } from '@/app/api/manage/reschedule/route';
import { GET as availabilityRoute } from '@/app/api/public/[slug]/availability/route';
import { POST as bookingsRoute } from '@/app/api/public/[slug]/bookings/route';
import { hashToken } from '@/lib/public-booking/links';
import { RATE_LIMITS, rateLimitKey } from '@/lib/public-booking/rate-limit';
import type {
	AvailabilityResponse,
	BookingCreated,
	PublicApiError,
} from '@/lib/public-booking/types';
import {
	instantToIso,
	localDateOf,
	plusDays,
	timeZone,
	zonedToInstant,
	type Instant,
} from '@/lib/time';
import { dbUrl, useLocalSupabaseEnv } from './local-supabase';

// Drives the public route handlers against the local stack with the real service-role client.

const zone = timeZone('America/Toronto');
const id = {
	shop: randomUUID(),
	other: randomUUID(),
	disabled: randomUUID(),
	staffA: randomUUID(),
	staffB: randomUUID(),
	otherStaff: randomUUID(),
	service: randomUUID(),
	inactiveService: randomUUID(),
	otherService: randomUUID(),
};
const slug = `pb-${id.shop.slice(0, 8)}`;
const otherSlug = `pb-other-${id.other.slice(0, 8)}`;
const disabledSlug = `pb-off-${id.disabled.slice(0, 8)}`;

const admin = new pg.Client({ connectionString: dbUrl });

// Shop-local date `days` from today; tests book well inside the horizon and away from "now".
const day = (days: number) => plusDays(localDateOf(Date.now() as Instant, zone), days);
const localIso = (days: number, hour: number, minute = 0) =>
	instantToIso(zonedToInstant(day(days), hour * 60 + minute, zone));

let phoneCounter = 0;
const nextPhone = () => `(416) 555-01${String(phoneCounter++).padStart(2, '0')}`;
const e164 = (phone: string) => `+1${phone.replace(/\D/g, '')}`;

function getAvailability(shopSlug: string, query: Record<string, string>) {
	const url = `http://localhost/api/public/${shopSlug}/availability?${new URLSearchParams(query)}`;
	return availabilityRoute(new NextRequest(url), { params: Promise.resolve({ slug: shopSlug }) });
}

function postJson(url: string, body: unknown, headers: Record<string, string> = {}) {
	return new NextRequest(url, {
		method: 'POST',
		body: JSON.stringify(body),
		headers: { 'content-type': 'application/json', ...headers },
	});
}

function book(
	body: Record<string, unknown>,
	options: { shopSlug?: string; src?: string; ip?: string } = {},
) {
	const shopSlug = options.shopSlug ?? slug;
	const src = options.src ? `?src=${encodeURIComponent(options.src)}` : '';
	const request = postJson(
		`http://localhost/api/public/${shopSlug}/bookings${src}`,
		body,
		options.ip ? { 'x-forwarded-for': options.ip } : {},
	);
	return bookingsRoute(request, { params: Promise.resolve({ slug: shopSlug }) });
}

const bookingBody = (overrides: Record<string, unknown> = {}) => ({
	serviceId: id.service,
	staffId: id.staffA,
	startsAt: localIso(2, 10),
	name: 'Pat Public',
	phone: nextPhone(),
	...overrides,
});

const cancel = (token: string) =>
	cancelRoute(postJson('http://localhost/api/manage/cancel', { token }));
const reschedule = (token: string, staffId: string, startsAt: string) =>
	rescheduleRoute(postJson('http://localhost/api/manage/reschedule', { token, staffId, startsAt }));

const tokenOf = (created: BookingCreated) => created.manageUrl.split('/b/')[1] ?? '';

async function bookingRow(token: string) {
	const { rows } = await admin.query<{
		id: string;
		status: string;
		staff_id: string;
		starts_at: Date;
		source: string;
		client_notes: string | null;
		expires_at: Date;
	}>(
		`select b.id, b.status, b.staff_id, b.starts_at, b.source, b.client_notes, l.expires_at
		 from public.booking_links l join public.bookings b on b.id = l.booking_id
		 where l.token_hash = $1`,
		[hashToken(token)],
	);
	return rows[0];
}

describe('public booking API', () => {
	beforeAll(async () => {
		useLocalSupabaseEnv();
		await admin.connect();
		await admin.query(
			`insert into public.shops (id, name, slug, timezone, min_lead_minutes, booking_page_enabled, address) values
			   ($1, 'Public Test', $4, 'America/Toronto', 0, true, '1 Test St'),
			   ($2, 'Other Test', $5, 'America/Toronto', 0, true, null),
			   ($3, 'Disabled Test', $6, 'America/Toronto', 0, false, null)`,
			[id.shop, id.other, id.disabled, slug, otherSlug, disabledSlug],
		);
		await admin.query(
			`insert into public.staff (id, shop_id, display_name) values
			   ($1, $4, 'Alex'), ($2, $4, 'Blair'), ($3, $5, 'Casey')`,
			[id.staffA, id.staffB, id.otherStaff, id.shop, id.other],
		);
		await admin.query(
			`insert into public.services (id, shop_id, name, duration_minutes, buffer_minutes, price_cents, active) values
			   ($1, $4, 'Haircut', 30, 10, 3500, true),
			   ($2, $4, 'Retired cut', 30, 0, 1000, false),
			   ($3, $5, 'Other cut', 30, 0, 3000, true)`,
			[id.service, id.inactiveService, id.otherService, id.shop, id.other],
		);
		// Alex works all day every day, Blair 09:00–17:00.
		await admin.query(
			`insert into public.availability_rules (shop_id, staff_id, weekday, start_time, end_time)
			 select $1::uuid, $2::uuid, d, '00:00'::time, '24:00'::time from generate_series(0, 6) d
			 union all
			 select $1::uuid, $3::uuid, d, '09:00'::time, '17:00'::time from generate_series(0, 6) d`,
			[id.shop, id.staffA, id.staffB],
		);
	});

	afterAll(async () => {
		await admin.query('delete from public.shops where id = any($1)', [
			[id.shop, id.other, id.disabled],
		]);
		await admin.end();
	});

	describe('GET availability', () => {
		const query = (overrides: Record<string, string> = {}) => ({
			serviceId: id.service,
			staffId: 'any',
			from: day(2),
			to: day(3),
			...overrides,
		});

		it('returns only start times, staff ids and labels', async () => {
			const res = await getAvailability(slug, query());
			expect(res.status).toBe(200);
			expect(res.headers.get('cache-control')).toContain('s-maxage');
			const body = (await res.json()) as AvailabilityResponse;
			expect(Object.keys(body).sort()).toEqual(['days', 'nextOpenDate', 'slots', 'timezone']);
			expect(body.days.map((d) => d.date)).toEqual([day(2), day(3)]);
			expect(body.slots.length).toBeGreaterThan(0);
			for (const slot of body.slots) {
				expect(Object.keys(slot).sort()).toEqual([
					'date',
					'label',
					'period',
					'staffId',
					'startsAt',
					'time',
				]);
				expect([id.staffA, id.staffB]).toContain(slot.staffId);
			}
			expect(body.nextOpenDate).toBe(day(2));
		});

		it('limits slots to the chosen stylist', async () => {
			const res = await getAvailability(slug, query({ staffId: id.staffB }));
			const body = (await res.json()) as AvailabilityResponse;
			expect(body.slots.length).toBeGreaterThan(0);
			expect(new Set(body.slots.map((s) => s.staffId))).toEqual(new Set([id.staffB]));
		});

		it('points to the next open day when the range is empty', async () => {
			const res = await getAvailability(slug, query({ from: day(-3), to: day(-2) }));
			const body = (await res.json()) as AvailabilityResponse;
			expect(body.slots).toEqual([]);
			expect(body.nextOpenDate).not.toBeNull();
			expect((body.nextOpenDate ?? '') >= day(0)).toBe(true);
		});

		it('rejects invalid queries and ranges over 7 days', async () => {
			expect((await getAvailability(slug, query({ to: day(9) }))).status).toBe(400);
			expect((await getAvailability(slug, query({ serviceId: 'nope' }))).status).toBe(400);
			expect((await getAvailability(slug, query({ from: '2026-13-01' }))).status).toBe(400);
		});

		it('404s for unknown or unpublished shops and services from elsewhere', async () => {
			expect((await getAvailability('no-such-shop-xyz', query())).status).toBe(404);
			expect((await getAvailability(disabledSlug, query())).status).toBe(404);
			expect((await getAvailability(slug, query({ serviceId: id.otherService }))).status).toBe(404);
			expect((await getAvailability(slug, query({ serviceId: id.inactiveService }))).status).toBe(
				404,
			);
			expect((await getAvailability(slug, query({ staffId: id.otherStaff }))).status).toBe(404);
		});

		it('rate limits per IP once the hourly bucket is full', async () => {
			const ip = `test-${randomUUID()}`;
			const { max, windowSeconds } = RATE_LIMITS.availabilityPerIp;
			await admin.query(`select public.hit_rate_limit($1, $2, $3) from generate_series(1, $3)`, [
				rateLimitKey('availability-ip', ip),
				windowSeconds,
				max,
			]);
			const url = `http://localhost/api/public/${slug}/availability?${new URLSearchParams(query())}`;
			const res = await availabilityRoute(
				new NextRequest(url, { headers: { 'x-forwarded-for': ip } }),
				{
					params: Promise.resolve({ slug }),
				},
			);
			expect(res.status).toBe(429);
			expect(res.headers.get('cache-control')).toBe('no-store');
		});
	});

	describe('POST bookings', () => {
		it('creates a confirmed booking and returns only what the client needs', async () => {
			const phone = nextPhone();
			const res = await book(
				bookingBody({ phone, startsAt: localIso(2, 9), notes: 'Side door please' }),
				{ src: 'Instagram' },
			);
			expect(res.status).toBe(201);
			const body = (await res.json()) as BookingCreated;
			expect(body.reference).toMatch(/^[0-9A-F]{8}$/);
			expect(body.manageUrl).toMatch(/\/b\/[A-Za-z0-9_-]{43}$/);
			expect(body.booking).toMatchObject({
				shopName: 'Public Test',
				serviceName: 'Haircut',
				staffName: 'Alex',
				startsAt: localIso(2, 9),
				durationMinutes: 30,
				priceCents: 3500,
				currency: 'CAD',
				timezone: 'America/Toronto',
			});
			expect(JSON.stringify(body)).not.toContain(id.shop);

			const row = await bookingRow(tokenOf(body));
			expect(row).toMatchObject({
				status: 'confirmed',
				source: 'instagram',
				client_notes: 'Side door please',
			});
			const { rows } = await admin.query(
				'select name, first_source from public.clients where shop_id = $1 and phone_e164 = $2',
				[id.shop, e164(phone)],
			);
			expect(rows).toEqual([{ name: 'Pat Public', first_source: 'instagram' }]);
		});

		it('finds the existing client by phone and only fills empty fields', async () => {
			const phone = nextPhone();
			expect((await book(bookingBody({ phone, startsAt: localIso(2, 11) }))).status).toBe(201);
			const second = await book(
				bookingBody({
					phone,
					startsAt: localIso(2, 12),
					name: 'Someone Else',
					email: 'Pat@Example.com',
				}),
			);
			expect(second.status).toBe(201);
			const { rows } = await admin.query(
				'select name, email from public.clients where shop_id = $1 and phone_e164 = $2',
				[id.shop, e164(phone)],
			);
			expect(rows).toEqual([{ name: 'Pat Public', email: 'pat@example.com' }]);
		});

		it('defaults the source to direct', async () => {
			const res = await book(bookingBody({ startsAt: localIso(2, 13) }), { src: '<bad>' });
			const row = await bookingRow(tokenOf((await res.json()) as BookingCreated));
			expect(row?.source).toBe('direct');
		});

		it('returns field errors for invalid input and rejects the honeypot', async () => {
			const res = await book({ serviceId: id.service, staffId: 'any', startsAt: localIso(2, 9) });
			expect(res.status).toBe(400);
			const body = (await res.json()) as Extract<PublicApiError, { error: 'invalid_request' }>;
			expect(body.fieldErrors).toHaveProperty('name');
			expect(body.fieldErrors).toHaveProperty('phone');

			const badPhone = await book(bookingBody({ phone: '12' }));
			expect(badPhone.status).toBe(400);
			expect(((await badPhone.json()) as { fieldErrors: object }).fieldErrors).toHaveProperty(
				'phone',
			);

			expect((await book(bookingBody({ website: 'http://spam.example' }))).status).toBe(400);
		});

		it('404s for an unknown shop and for another shop’s service', async () => {
			expect((await book(bookingBody(), { shopSlug: 'no-such-shop-xyz' })).status).toBe(404);
			expect((await book(bookingBody({ serviceId: id.otherService }))).status).toBe(404);
			expect((await book(bookingBody({ staffId: id.otherStaff }))).status).toBe(404);
		});

		it('rejects times outside hours or off the slot grid', async () => {
			const outside = await book(bookingBody({ staffId: id.staffB, startsAt: localIso(2, 3) }));
			expect(outside.status).toBe(422);
			expect(await outside.json()).toMatchObject({
				error: 'slot_unavailable',
				reason: 'outside_hours',
			});

			const misaligned = await book(bookingBody({ startsAt: localIso(2, 10, 7) }));
			expect(misaligned.status).toBe(422);
			expect(await misaligned.json()).toMatchObject({ reason: 'misaligned' });
		});

		it('409s with nearby suggestions when the time is taken, and "any" falls back', async () => {
			const startsAt = localIso(3, 10);
			expect((await book(bookingBody({ startsAt }))).status).toBe(201);

			const taken = await book(bookingBody({ startsAt }));
			expect(taken.status).toBe(409);
			const body = (await taken.json()) as Extract<PublicApiError, { error: 'slot_taken' }>;
			expect(body.error).toBe('slot_taken');
			expect(body.suggestions.length).toBeGreaterThan(0);
			expect(body.suggestions.map((s) => s.startsAt)).not.toContain(
				new Date(startsAt).toISOString(),
			);

			const any = await book(bookingBody({ staffId: 'any', startsAt }));
			expect(any.status).toBe(201);
			expect(((await any.json()) as BookingCreated).booking.staffName).toBe('Blair');

			expect((await book(bookingBody({ staffId: 'any', startsAt }))).status).toBe(409);
		});

		it('lets exactly one of several simultaneous requests win', async () => {
			const startsAt = localIso(4, 10);
			const results = await Promise.all(
				Array.from({ length: 5 }, () => book(bookingBody({ startsAt }))),
			);
			const statuses = results.map((r) => r.status).sort();
			expect(statuses).toEqual([201, 409, 409, 409, 409]);
		});

		it('caps active future bookings per phone', async () => {
			const phone = nextPhone();
			for (const hour of [14, 15, 16]) {
				expect((await book(bookingBody({ phone, startsAt: localIso(5, hour) }))).status).toBe(201);
			}
			const fourth = await book(bookingBody({ phone, startsAt: localIso(5, 17) }));
			expect(fourth.status).toBe(409);
			expect(await fourth.json()).toMatchObject({ error: 'too_many_bookings' });
		});

		it('rate limits per phone and per IP', async () => {
			const phone = nextPhone();
			const attempt = () => book(bookingBody({ phone, startsAt: localIso(6, 10, 7) }));
			for (let i = 0; i < 5; i++) expect((await attempt()).status).toBe(422);
			const limited = await attempt();
			expect(limited.status).toBe(429);
			expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);

			const ip = `test-${randomUUID()}`;
			for (let i = 0; i < 10; i++) {
				expect((await book(bookingBody(), { shopSlug: 'no-such-shop-xyz', ip })).status).toBe(404);
			}
			expect((await book(bookingBody(), { shopSlug: 'no-such-shop-xyz', ip })).status).toBe(429);
		});
	});

	describe('manage links', () => {
		async function created(days: number, hour: number, minute = 0): Promise<string> {
			const res = await book(bookingBody({ startsAt: localIso(days, hour, minute) }));
			expect(res.status).toBe(201);
			return tokenOf((await res.json()) as BookingCreated);
		}

		it('rejects malformed, tampered, expired and revoked tokens alike', async () => {
			const token = await created(7, 9);
			const tampered = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
			for (const bad of ['', 'short', tampered]) {
				const res = await cancel(bad);
				expect(res.status).toBe(404);
				expect(await res.json()).toMatchObject({ error: 'not_found' });
			}

			await admin.query(
				`update public.booking_links set expires_at = now() - interval '1 minute' where token_hash = $1`,
				[hashToken(token)],
			);
			expect((await cancel(token)).status).toBe(404);

			const revoked = await created(7, 10);
			await admin.query(
				'update public.booking_links set revoked_at = now() where token_hash = $1',
				[hashToken(revoked)],
			);
			expect((await cancel(revoked)).status).toBe(404);
			expect((await bookingRow(revoked))?.status).toBe('confirmed');
		});

		it('cancels only its own booking and frees the slot', async () => {
			const mine = await created(7, 12);
			const theirs = await created(7, 13);

			expect((await cancel(mine)).status).toBe(200);
			expect((await bookingRow(mine))?.status).toBe('cancelled');
			expect((await bookingRow(theirs))?.status).toBe('confirmed');

			const res = await getAvailability(slug, {
				serviceId: id.service,
				staffId: id.staffA,
				from: day(7),
				to: day(7),
			});
			const body = (await res.json()) as AvailabilityResponse;
			expect(body.slots.map((s) => s.startsAt)).toContain(new Date(localIso(7, 12)).toISOString());

			const again = await cancel(mine);
			expect(again.status).toBe(409);
			expect(await again.json()).toMatchObject({ error: 'not_active' });
		});

		it('refuses changes inside the shop’s cutoff window', async () => {
			// With a 7-day cutoff, a booking 6 days out is already past its deadline.
			const token = await created(6, 14);
			await admin.query('update public.shops set cancel_cutoff_hours = 168 where id = $1', [
				id.shop,
			]);
			try {
				const res = await cancel(token);
				expect(res.status).toBe(422);
				expect(await res.json()).toMatchObject({ error: 'cancel_window_passed' });
				expect((await reschedule(token, 'any', localIso(7, 16))).status).toBe(422);
			} finally {
				await admin.query('update public.shops set cancel_cutoff_hours = 2 where id = $1', [
					id.shop,
				]);
			}
			expect((await bookingRow(token))?.status).toBe('confirmed');
		});

		it('reschedules, including onto an overlap with its own old time', async () => {
			const token = await created(8, 10);
			const overlapping = localIso(8, 10, 15);
			const res = await reschedule(token, id.staffA, overlapping);
			expect(res.status).toBe(200);
			expect(await res.json()).toMatchObject({ booking: { staffName: 'Alex' } });

			const row = await bookingRow(token);
			expect(row?.starts_at.toISOString()).toBe(new Date(overlapping).toISOString());
			expect(row?.expires_at.getTime()).toBe(new Date(overlapping).getTime() + 7 * 86_400_000);
		});

		it('409s with suggestions when the new time is taken', async () => {
			const token = await created(8, 13);
			await created(8, 15);
			const res = await reschedule(token, id.staffA, localIso(8, 15));
			expect(res.status).toBe(409);
			const body = (await res.json()) as Extract<PublicApiError, { error: 'slot_taken' }>;
			expect(body.suggestions.length).toBeGreaterThan(0);
			expect((await bookingRow(token))?.starts_at.toISOString()).toBe(
				new Date(localIso(8, 13)).toISOString(),
			);
		});
	});
});
