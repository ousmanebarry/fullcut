import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import pg from 'pg';
import twilio from 'twilio';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POST as leaveRoute } from '@/app/api/waitlist/leave/route';
import { POST as joinRoute } from '@/app/api/public/[slug]/waitlist/route';
import { POST as inboundRoute } from '@/app/api/webhooks/twilio/inbound/route';
import type { MessageSender, OutgoingSms } from '@/lib/messaging/sender';
import { INBOUND_PATH, STATUS_CALLBACK_PATH } from '@/lib/messaging/webhooks';
import { runMessageBatch } from '@/lib/messaging/worker';
import type { PublicApiError } from '@/lib/public-booking/types';
import { createAdminClient } from '@/lib/supabase/admin';
import { localDateOf, plusDays, timeZone, type Instant } from '@/lib/time';
import { findEntryByToken } from '@/lib/waitlist/manage';
import { dbUrl, useLocalSupabaseEnv } from './local-supabase';

// Joining, leaving and STOP against the local stack with the real service-role client and a fake sender.

const AUTH_TOKEN = 'test-twilio-auth-token-not-a-real-one';
const BASE_URL = 'https://fullcut.test';
const zone = timeZone('America/Toronto');

const id = {
	shop: randomUUID(),
	off: randomUUID(),
	staff: randomUUID(),
	staffTwo: randomUUID(),
	offStaff: randomUUID(),
	service: randomUUID(),
	offService: randomUUID(),
};
const slug = `wl-${id.shop.slice(0, 8)}`;
const offSlug = `wl-off-${id.off.slice(0, 8)}`;

const pool = new pg.Client({ connectionString: dbUrl });

const day = (days: number) => plusDays(localDateOf(Date.now() as Instant, zone), days);

let phoneCounter = 0;
// +1 647 555 02xx: valid for libphonenumber, distinct from the other suites' numbers.
const nextPhone = () => `+164755502${String(phoneCounter++).padStart(2, '0')}`;
let ipCounter = 0;
// Random block per run: the IP rate limit window outlives a test run.
const ipBlock = randomInt(1, 250);
const nextIp = () => `10.77.${ipBlock}.${(ipCounter++ % 250) + 1}`;

const body = (overrides: Record<string, unknown> = {}) => ({
	serviceId: id.service,
	staffId: 'any',
	earliestDate: day(1),
	latestDate: day(10),
	timeWindows: [],
	name: 'Wendy Waitlist',
	phone: nextPhone(),
	offersRequested: true,
	...overrides,
});

function join(payload: Record<string, unknown>, shopSlug = slug) {
	const request = new NextRequest(`http://localhost/api/public/${shopSlug}/waitlist`, {
		method: 'POST',
		body: JSON.stringify(payload),
		headers: { 'content-type': 'application/json', 'x-forwarded-for': nextIp() },
	});
	return joinRoute(request, { params: Promise.resolve({ slug: shopSlug }) });
}

const leave = (token: string) =>
	leaveRoute(
		new Request('http://localhost/api/waitlist/leave', {
			method: 'POST',
			body: JSON.stringify({ token }),
			headers: { 'content-type': 'application/json' },
		}),
	);

async function errorOf(response: Response): Promise<PublicApiError> {
	return (await response.json()) as PublicApiError;
}

interface EntryRow {
	id: string;
	status: string;
	staff_id: string | null;
	request_method: string;
	time_windows: unknown;
	earliest_date: string;
}

async function entriesFor(phone: string): Promise<EntryRow[]> {
	const { rows } = await pool.query<EntryRow>(
		`select e.id, e.status, e.staff_id, e.request_method, e.time_windows, e.earliest_date::text
		 from public.waitlist_entries e
		 join public.clients c on c.shop_id = e.shop_id and c.id = e.client_id
		 where e.shop_id = $1 and c.phone_e164 = $2 order by e.created_at`,
		[id.shop, phone],
	);
	return rows;
}

function capture() {
	const sent: OutgoingSms[] = [];
	const sender: MessageSender = {
		mode: 'twilio',
		async send(sms) {
			sent.push(sms);
			return { ok: true, sid: `SM${randomBytes(16).toString('hex')}`, deliveryStatus: 'accepted' };
		},
	};
	return { sent, sender, to: (phone: string) => sent.filter((s) => s.to === phone) };
}

const runWorker = (sender: MessageSender) =>
	runMessageBatch(createAdminClient(), {
		sender,
		siteUrl: BASE_URL,
		statusCallbackUrl: `${BASE_URL}${STATUS_CALLBACK_PATH}`,
	});

describe('waitlist joining and leaving', () => {
	beforeAll(async () => {
		useLocalSupabaseEnv();
		process.env.TWILIO_AUTH_TOKEN = AUTH_TOKEN;
		process.env.TWILIO_WEBHOOK_BASE_URL = BASE_URL;
		delete process.env.MESSAGING_MODE;
		await pool.connect();
		await pool.query(
			`insert into public.shops (id, name, slug, timezone, min_lead_minutes, max_horizon_days, waitlist_enabled) values
			   ($1, 'Waitlist Test', $3, 'America/Toronto', 0, 30, true),
			   ($2, 'Waitlist Off', $4, 'America/Toronto', 0, 30, false)`,
			[id.shop, id.off, slug, offSlug],
		);
		await pool.query(
			`insert into public.staff (id, shop_id, display_name) values
			   ($1, $4, 'Alex'), ($2, $4, 'Blair'), ($3, $5, 'Casey')`,
			[id.staff, id.staffTwo, id.offStaff, id.shop, id.off],
		);
		await pool.query(
			`insert into public.services (id, shop_id, name, duration_minutes, price_cents) values
			   ($1, $3, 'Haircut', 30, 3500), ($2, $4, 'Other cut', 30, 3000)`,
			[id.service, id.offService, id.shop, id.off],
		);
	});

	afterAll(async () => {
		await pool.query('delete from public.shops where id = any($1)', [[id.shop, id.off]]);
		await pool.end();
	});

	it('joins from the booking page and stores any-staff and windows as asked', async () => {
		const phone = nextPhone();
		const windows = [{ weekday: 6, start: '09:00', end: '13:00' }];
		const response = await join(body({ phone, timeWindows: windows }));
		expect(response.status).toBe(201);

		const [entry, ...rest] = await entriesFor(phone);
		expect(rest).toHaveLength(0);
		expect(entry).toMatchObject({
			status: 'active',
			staff_id: null,
			request_method: 'booking_page',
			time_windows: windows,
			earliest_date: day(1),
		});
	});

	it('stores a chosen stylist', async () => {
		const phone = nextPhone();
		expect((await join(body({ phone, staffId: id.staffTwo }))).status).toBe(201);
		expect((await entriesFor(phone))[0]?.staff_id).toBe(id.staffTwo);
	});

	it('rejects the honeypot without creating anything', async () => {
		const phone = nextPhone();
		const response = await join(body({ phone, website: 'http://spam.example' }));
		expect(response.status).toBe(400);
		expect(await entriesFor(phone)).toHaveLength(0);
	});

	it('requires the box to be ticked', async () => {
		const response = await join(body({ offersRequested: false }));
		expect(response.status).toBe(400);
		const error = await errorOf(response);
		expect(error.error === 'invalid_request' && error.fieldErrors?.offersRequested).toBeTruthy();
	});

	it('rejects dates in the past, beyond the horizon and in the wrong order', async () => {
		const past = await errorOf(await join(body({ earliestDate: day(-1) })));
		expect(past.error === 'invalid_request' && past.fieldErrors?.earliestDate).toBeTruthy();

		const far = await errorOf(await join(body({ latestDate: day(45) })));
		expect(far.error === 'invalid_request' && far.fieldErrors?.latestDate).toBeTruthy();

		const reversed = await join(body({ earliestDate: day(5), latestDate: day(2) }));
		expect(reversed.status).toBe(400);
	});

	it('rejects malformed windows', async () => {
		const response = await join(
			body({ timeWindows: [{ weekday: 1, start: '12:00', end: '09:00' }] }),
		);
		expect(response.status).toBe(400);
	});

	it('refuses an unknown or other-shop service', async () => {
		expect((await join(body({ serviceId: id.offService }))).status).toBe(404);
		expect((await join(body({ serviceId: randomUUID() }))).status).toBe(404);
	});

	it('is closed while the shop has the waitlist off', async () => {
		const response = await join(body({ serviceId: id.offService }), offSlug);
		expect(response.status).toBe(409);
		expect((await errorOf(response)).error).toBe('waitlist_disabled');
	});

	it('caps active entries per phone', async () => {
		const phone = nextPhone();
		for (let i = 0; i < 3; i++) expect((await join(body({ phone }))).status).toBe(201);
		const response = await join(body({ phone }));
		expect(response.status).toBe(409);
		expect((await errorOf(response)).error).toBe('too_many_waitlist_entries');
		expect(await entriesFor(phone)).toHaveLength(3);
	});

	it('texts a confirmation with a link that shows and leaves the waitlist', async () => {
		const phone = nextPhone();
		expect((await join(body({ phone }))).status).toBe(201);

		const fake = capture();
		await runWorker(fake.sender);
		const [text, ...rest] = fake.to(phone);
		expect(rest).toHaveLength(0);
		expect(text?.body).toContain('Waitlist Test');
		expect(text?.body).toContain('Haircut');

		const token = /\/wl\/([A-Za-z0-9_-]{43})/.exec(text?.body ?? '')?.[1] ?? '';
		expect(token).not.toBe('');

		const { rows } = await pool.query<{ body: string }>(
			`select m.body from public.scheduled_messages m
			 join public.waitlist_entries e on e.shop_id = m.shop_id and e.id = m.waitlist_entry_id
			 join public.clients c on c.shop_id = e.shop_id and c.id = e.client_id
			 where c.phone_e164 = $1`,
			[phone],
		);
		expect(rows[0]?.body).toContain('[waitlist link]');
		expect(rows[0]?.body).not.toContain(token);

		const now = Date.now() as Instant;
		const entry = await findEntryByToken(createAdminClient(), token, now);
		expect(entry).toMatchObject({ status: 'active', serviceName: 'Haircut', staffName: null });

		expect((await leave(token)).status).toBe(200);
		expect((await entriesFor(phone))[0]?.status).toBe('cancelled');
		// Leaving twice is harmless and the link keeps working to show the outcome.
		expect((await leave(token)).status).toBe(200);
		expect((await findEntryByToken(createAdminClient(), token, now))?.status).toBe('cancelled');
	});

	it('rejects forged, malformed and unknown leave tokens alike', async () => {
		expect((await leave('nope')).status).toBe(404);
		expect((await leave('A'.repeat(43))).status).toBe(404);
		expect(
			await findEntryByToken(createAdminClient(), 'A'.repeat(43), Date.now() as Instant),
		).toBeNull();
	});

	it('does not text a client who left before the confirmation went out', async () => {
		const phone = nextPhone();
		await join(body({ phone }));
		await pool.query(
			`update public.waitlist_entries set status = 'cancelled'
			 where shop_id = $1 and client_id = (select id from public.clients where shop_id = $1 and phone_e164 = $2)`,
			[id.shop, phone],
		);
		const fake = capture();
		await runWorker(fake.sender);
		expect(fake.to(phone)).toHaveLength(0);
	});

	it('cancels active entries when the client replies STOP', async () => {
		const phone = nextPhone();
		await join(body({ phone }));
		await join(body({ phone, staffId: id.staff }));
		expect((await entriesFor(phone)).filter((e) => e.status === 'active')).toHaveLength(2);

		const params = {
			MessageSid: `SM${randomBytes(16).toString('hex')}`,
			From: phone,
			To: '+16475550000',
			Body: 'STOP',
		};
		const signature = twilio.getExpectedTwilioSignature(
			AUTH_TOKEN,
			`${BASE_URL}${INBOUND_PATH}`,
			params,
		);
		const response = await inboundRoute(
			new Request(`${BASE_URL}${INBOUND_PATH}`, {
				method: 'POST',
				headers: {
					'content-type': 'application/x-www-form-urlencoded',
					'x-twilio-signature': signature,
				},
				body: new URLSearchParams(params).toString(),
			}),
		);
		expect(response.status).toBe(200);
		expect((await entriesFor(phone)).filter((e) => e.status === 'active')).toHaveLength(0);

		const blocked = await join(body({ phone }));
		expect(blocked.status).toBe(409);
		expect((await errorOf(blocked)).error).toBe('sms_opted_out');
	});
});
