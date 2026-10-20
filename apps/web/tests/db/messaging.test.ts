import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import twilio from 'twilio';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POST as tickRoute } from '@/app/api/jobs/tick/route';
import { POST as inboundRoute } from '@/app/api/webhooks/twilio/inbound/route';
import { POST as statusRoute } from '@/app/api/webhooks/twilio/status/route';
import type { MessageSender, OutgoingSms, SendResult } from '@/lib/messaging/sender';
import { INBOUND_PATH, STATUS_CALLBACK_PATH } from '@/lib/messaging/webhooks';
import { runMessageBatch } from '@/lib/messaging/worker';
import { findBookingByToken } from '@/lib/public-booking/manage';
import type { Db } from '@/lib/shop/settings';
import { createAdminClient } from '@/lib/supabase/admin';
import { localMinuteOfDay, timeZone, type Instant } from '@/lib/time';
import { dbUrl, useLocalSupabaseEnv } from './local-supabase';

// Worker, job tick and Twilio webhooks against the local stack, with a fake sender (never Twilio).

const AUTH_TOKEN = 'test-twilio-auth-token-not-a-real-one';
const BASE_URL = 'https://fullcut.test';
const JOBS_SECRET = 'test-jobs-secret-0123456789abcdef0123456789';
const SLUG_PREFIX = 'msg-test-';

/** An Etc/GMT zone whose current local hour passes `test`, so results don't depend on when tests run. */
function zoneWhereHour(test: (hour: number) => boolean): string {
	for (let offset = -12; offset <= 14; offset++) {
		const zone = offset === 0 ? 'Etc/GMT' : `Etc/GMT${offset > 0 ? '-' : '+'}${Math.abs(offset)}`;
		const hour = Number(
			new Intl.DateTimeFormat('en-US', {
				timeZone: zone,
				hour: 'numeric',
				hourCycle: 'h23',
			}).format(new Date()),
		);
		if (test(hour)) return zone;
	}
	throw new Error('no matching zone');
}

const dayZone = zoneWhereHour((h) => h >= 11 && h <= 17);
const nightZone = zoneWhereHour((h) => h >= 23 || h <= 6);

const id = {
	day: randomUUID(),
	night: randomUUID(),
	dayStaff: randomUUID(),
	nightStaff: randomUUID(),
	dayService: randomUUID(),
	nightService: randomUUID(),
};

const pool = new pg.Client({ connectionString: dbUrl });
let db: Db;

let phoneCounter = 0;
// +1 647 555 01xx: valid for libphonenumber, distinct from other suites' 416 numbers.
const nextPhone = () => `+164755501${String(phoneCounter++).padStart(2, '0')}`;
let slot = 0;
const nextStart = () => new Date(Date.now() + 3 * 86_400_000 + slot++ * 3_600_000);
const newSid = () => `SM${randomBytes(16).toString('hex')}`;

type ShopKey = 'day' | 'night';

async function addClient(shop: ShopKey = 'day'): Promise<{ id: string; phone: string }> {
	const phone = nextPhone();
	const { rows } = await pool.query<{ id: string }>(
		`insert into public.clients (shop_id, name, phone_e164) values ($1, 'Pat Text', $2) returning id`,
		[id[shop], phone],
	);
	return { id: rows[0]?.id ?? '', phone };
}

async function addBooking(clientId: string, shop: ShopKey = 'day'): Promise<string> {
	const staff = shop === 'day' ? id.dayStaff : id.nightStaff;
	const service = shop === 'day' ? id.dayService : id.nightService;
	const { rows } = await pool.query<{ id: string }>(
		`insert into public.bookings (shop_id, staff_id, client_id, service_id, starts_at, ends_at, blocked_until, status, price_cents)
		 values ($1, $2, $3, $4, $5, $5::timestamptz + interval '30 minutes', $5::timestamptz + interval '30 minutes', 'confirmed', 3000)
		 returning id`,
		[id[shop], staff, clientId, service, nextStart()],
	);
	return rows[0]?.id ?? '';
}

interface MessageRow {
	type: string;
	status: string;
	skip_reason: string | null;
	attempts: number;
	body: string | null;
	twilio_sid: string | null;
	delivery_status: string | null;
	delivered_at: Date | null;
	send_at: Date;
}

async function messages(bookingId: string): Promise<MessageRow[]> {
	const { rows } = await pool.query<MessageRow>(
		`select type, status, skip_reason, attempts, body, twilio_sid, delivery_status, delivered_at, send_at
		 from public.scheduled_messages where booking_id = $1 order by type`,
		[bookingId],
	);
	return rows;
}

async function message(bookingId: string, type: string): Promise<MessageRow | undefined> {
	return (await messages(bookingId)).find((m) => m.type === type);
}

// The worker claims every due row in the database, so responses other than success only target our phone.
function capture(respond?: (sms: OutgoingSms) => SendResult | undefined) {
	const sent: OutgoingSms[] = [];
	const sender: MessageSender = {
		mode: 'twilio',
		async send(sms) {
			sent.push(sms);
			return respond?.(sms) ?? { ok: true, sid: newSid(), deliveryStatus: 'accepted' };
		},
	};
	return { sent, sender, to: (phone: string) => sent.filter((s) => s.to === phone) };
}

const run = (sender: MessageSender) =>
	runMessageBatch(db, {
		sender,
		siteUrl: BASE_URL,
		statusCallbackUrl: `${BASE_URL}${STATUS_CALLBACK_PATH}`,
	});

function twilioRequest(path: string, params: Record<string, string>, signature?: string | null) {
	const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' };
	const sig =
		signature === undefined
			? twilio.getExpectedTwilioSignature(AUTH_TOKEN, `${BASE_URL}${path}`, params)
			: signature;
	if (sig !== null) headers['x-twilio-signature'] = sig;
	return new Request(`${BASE_URL}${path}`, {
		method: 'POST',
		headers,
		body: new URLSearchParams(params).toString(),
	});
}

const inbound = (from: string, body: string, sid = newSid()) =>
	inboundRoute(
		twilioRequest(INBOUND_PATH, { MessageSid: sid, From: from, To: '+16475550000', Body: body }),
	);

const statusCallback = (sid: string, status: string) =>
	statusRoute(twilioRequest(STATUS_CALLBACK_PATH, { MessageSid: sid, MessageStatus: status }));

async function optedOut(clientId: string): Promise<boolean> {
	const { rows } = await pool.query<{ sms_opted_out: boolean }>(
		'select sms_opted_out from public.clients where id = $1',
		[clientId],
	);
	return rows[0]?.sms_opted_out ?? false;
}

async function cancelByShop(bookingId: string) {
	await pool.query(
		`update public.bookings set status = 'cancelled', cancelled_by = 'shop' where id = $1`,
		[bookingId],
	);
}

describe('messaging', () => {
	beforeAll(async () => {
		useLocalSupabaseEnv();
		process.env.TWILIO_AUTH_TOKEN = AUTH_TOKEN;
		process.env.TWILIO_WEBHOOK_BASE_URL = BASE_URL;
		process.env.JOBS_SECRET = JOBS_SECRET;
		delete process.env.MESSAGING_MODE;
		db = createAdminClient();
		await pool.connect();
		await pool.query(`delete from public.shops where slug like $1`, [`${SLUG_PREFIX}%`]);
		await pool.query(
			`insert into public.shops (id, name, slug, timezone) values
			   ($1, 'Day Shop', $3, $5), ($2, 'Night Shop', $4, $6)`,
			[
				id.day,
				id.night,
				`${SLUG_PREFIX}day-${id.day.slice(0, 8)}`,
				`${SLUG_PREFIX}night-${id.night.slice(0, 8)}`,
				dayZone,
				nightZone,
			],
		);
		await pool.query(
			`insert into public.staff (id, shop_id, display_name) values ($1, $3, 'Sam'), ($2, $4, 'Noor')`,
			[id.dayStaff, id.nightStaff, id.day, id.night],
		);
		await pool.query(
			`insert into public.services (id, shop_id, name, duration_minutes, price_cents) values
			   ($1, $3, 'Skin Fade', 30, 3000), ($2, $4, 'Beard Trim', 30, 2000)`,
			[id.dayService, id.nightService, id.day, id.night],
		);
	});

	afterAll(async () => {
		await pool.query('delete from public.shops where id = any($1)', [[id.day, id.night]]);
		await pool.end();
	});

	describe('job tick', () => {
		const tick = (authorization?: string) =>
			tickRoute(
				new Request('http://localhost/api/jobs/tick', {
					method: 'POST',
					headers: authorization ? { authorization } : {},
				}),
			);

		it('rejects requests without the secret', async () => {
			expect((await tick()).status).toBe(401);
			expect((await tick('Bearer wrong-secret')).status).toBe(401);
			expect((await tick(JOBS_SECRET)).status).toBe(401);
		});

		it('runs due work with the secret (log mode)', async () => {
			const res = await tick(`Bearer ${JOBS_SECRET}`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as { messages: Record<string, number> };
			expect(Object.keys(body.messages).sort()).toEqual([
				'deferred',
				'failed',
				'retried',
				'sent',
				'skipped',
			]);
		});
	});

	describe('worker', () => {
		it('sends a confirmation with a working manage link, storing it without the link', async () => {
			const client = await addClient();
			const bookingId = await addBooking(client.id);
			const { sender, to } = capture();
			await run(sender);

			const [sms] = to(client.phone);
			expect(to(client.phone)).toHaveLength(1);
			expect(sms?.body).toMatch(/^Day Shop: your Skin Fade with Sam is booked for /);
			expect(sms?.statusCallback).toBe(`${BASE_URL}${STATUS_CALLBACK_PATH}`);

			const token = /\/b\/([A-Za-z0-9_-]{43})/.exec(sms?.body ?? '')?.[1] ?? '';
			const managed = await findBookingByToken(db, token, Date.now() as Instant);
			expect(managed?.bookingId).toBe(bookingId);

			const confirmation = await message(bookingId, 'confirmation');
			expect(confirmation).toMatchObject({ status: 'sent', delivery_status: 'accepted' });
			expect(confirmation?.twilio_sid).toMatch(/^SM/);
			expect(confirmation?.body).toContain('[manage link]');
			expect(confirmation?.body).not.toContain(token);
			expect((await message(bookingId, 'reminder'))?.status).toBe('queued');
		});

		it('two workers running at once never send the same message', async () => {
			const clients = [];
			const bookings = [];
			for (let i = 0; i < 12; i++) {
				const client = await addClient();
				clients.push(client);
				bookings.push(await addBooking(client.id));
			}
			const a = capture();
			const b = capture();
			await Promise.all([run(a.sender), run(b.sender)]);

			const phones = new Set(clients.map((c) => c.phone));
			const sent = [...a.sent, ...b.sent].filter((s) => phones.has(s.to));
			expect(sent).toHaveLength(12);
			expect(new Set(sent.map((s) => s.to)).size).toBe(12);
			for (const bookingId of bookings) {
				expect((await message(bookingId, 'confirmation'))?.status).toBe('sent');
			}
		});

		it('retries temporary failures with backoff, then gives up after 3 attempts', async () => {
			const client = await addClient();
			const bookingId = await addBooking(client.id);
			const failing = capture((sms) =>
				sms.to === client.phone
					? { ok: false, retryable: true, code: null, message: 'twilio_503' }
					: undefined,
			);

			for (const attempt of [1, 2]) {
				await run(failing.sender);
				const row = await message(bookingId, 'confirmation');
				expect(row).toMatchObject({ status: 'queued', attempts: attempt });
				expect(row?.send_at.getTime()).toBeGreaterThan(Date.now());
				await pool.query(
					`update public.scheduled_messages set send_at = now() where booking_id = $1 and type = 'confirmation'`,
					[bookingId],
				);
			}
			await run(failing.sender);
			expect(await message(bookingId, 'confirmation')).toMatchObject({
				status: 'failed',
				attempts: 3,
			});
			expect(failing.to(client.phone)).toHaveLength(3);
		});

		it('an unsubscribed number fails without retry and marks the client opted out', async () => {
			const client = await addClient();
			const bookingId = await addBooking(client.id);
			await run(
				capture((sms) =>
					sms.to === client.phone
						? { ok: false, retryable: false, code: 21610, message: 'twilio_400_21610' }
						: undefined,
				).sender,
			);
			expect(await message(bookingId, 'confirmation')).toMatchObject({
				status: 'failed',
				attempts: 1,
			});
			expect(await optedOut(client.id)).toBe(true);
		});

		it('quiet hours: confirmations go out, a cancellation notice waits for 09:00 shop time', async () => {
			const client = await addClient('night');
			const bookingId = await addBooking(client.id, 'night');
			const { sender, to } = capture();
			await run(sender);
			expect(to(client.phone)).toHaveLength(1);

			await cancelByShop(bookingId);
			await run(sender);
			expect(to(client.phone)).toHaveLength(1);
			const notice = await message(bookingId, 'cancelled');
			expect(notice?.status).toBe('queued');
			const sendAt = (notice?.send_at.getTime() ?? 0) as Instant;
			expect(sendAt).toBeGreaterThan(Date.now());
			expect(localMinuteOfDay(sendAt, timeZone(nightZone))).toBe(9 * 60);
			expect(notice?.attempts).toBe(0);
		});
	});

	describe('Twilio webhooks', () => {
		it.each([
			['inbound', inboundRoute, INBOUND_PATH],
			['status', statusRoute, STATUS_CALLBACK_PATH],
		] as const)('%s rejects unsigned and wrongly signed requests', async (_name, route, path) => {
			const params = {
				MessageSid: newSid(),
				MessageStatus: 'delivered',
				From: '+16475550199',
				Body: 'STOP',
			};
			expect((await route(twilioRequest(path, params, null))).status).toBe(403);
			expect((await route(twilioRequest(path, params, 'bm90IGEgc2lnbmF0dXJl'))).status).toBe(403);
			const otherUrl = twilio.getExpectedTwilioSignature(
				AUTH_TOKEN,
				`${BASE_URL}/elsewhere`,
				params,
			);
			expect((await route(twilioRequest(path, params, otherUrl))).status).toBe(403);
			const signed = twilioRequest(path, params);
			const tampered = new Request(signed, {
				body: new URLSearchParams({ ...params, Body: 'START' }).toString(),
			});
			expect((await route(tampered)).status).toBe(403);
		});

		it('STOP blocks later texts; START allows them again', async () => {
			const client = await addClient();
			const first = await addBooking(client.id);
			const { sender, to } = capture();
			await run(sender);
			expect(to(client.phone)).toHaveLength(1);

			const res = await inbound(client.phone, 'Stop');
			expect(res.status).toBe(200);
			expect(res.headers.get('content-type')).toBe('text/xml');
			expect(await optedOut(client.id)).toBe(true);

			await cancelByShop(first);
			const second = await addBooking(client.id);
			await run(sender);
			expect(to(client.phone)).toHaveLength(1);
			expect((await message(second, 'confirmation'))?.skip_reason).toBe('opted_out');

			await inbound(client.phone, 'START');
			expect(await optedOut(client.id)).toBe(false);
			const third = await addBooking(client.id);
			await run(sender);
			expect(to(client.phone)).toHaveLength(2);
			expect((await message(third, 'confirmation'))?.status).toBe('sent');

			const { rows } = await pool.query<{ kind: string; handled: boolean }>(
				`select kind, handled_at is not null as handled from public.inbound_messages
				 where client_id = $1 order by created_at`,
				[client.id],
			);
			expect(rows).toEqual([
				{ kind: 'opt_out', handled: true },
				{ kind: 'opt_in', handled: true },
			]);
		});

		it('a replayed inbound webhook is processed once', async () => {
			const client = await addClient();
			const sid = newSid();
			await inbound(client.phone, 'STOP', sid);
			expect(await optedOut(client.id)).toBe(true);
			await pool.query('update public.clients set sms_opted_out = false where id = $1', [
				client.id,
			]);
			const replay = await inbound(client.phone, 'STOP', sid);
			expect(replay.status).toBe(200);
			expect(await optedOut(client.id)).toBe(false);
		});

		it('YES confirms the client’s next booking only', async () => {
			const client = await addClient();
			const next = await addBooking(client.id);
			const later = await addBooking(client.id);
			await inbound(client.phone, 'yes');
			const { rows } = await pool.query<{ id: string; confirmed: boolean }>(
				`select id, client_confirmed_at is not null as confirmed from public.bookings where id = any($1)`,
				[[next, later]],
			);
			expect(Object.fromEntries(rows.map((r) => [r.id, r.confirmed]))).toEqual({
				[next]: true,
				[later]: false,
			});
		});

		it('free text goes to the inbox of the shop with the next booking; unknown numbers are dropped', async () => {
			const client = await addClient();
			const bookingId = await addBooking(client.id);
			await inbound(client.phone, 'Running 10 min late');
			const { rows } = await pool.query(
				`select shop_id, booking_id, kind, body, handled_at from public.inbound_messages where client_id = $1`,
				[client.id],
			);
			expect(rows).toEqual([
				{
					shop_id: id.day,
					booking_id: bookingId,
					kind: 'other',
					body: 'Running 10 min late',
					handled_at: null,
				},
			]);

			const sid = newSid();
			expect((await inbound('+16475550198', 'Who is this?', sid)).status).toBe(200);
			const dropped = await pool.query(
				'select 1 from public.inbound_messages where twilio_sid = $1',
				[sid],
			);
			expect(dropped.rowCount).toBe(0);
		});

		it('status callbacks record delivery, never go backwards, and ignore replays', async () => {
			const client = await addClient();
			const bookingId = await addBooking(client.id);
			await run(capture().sender);
			const sid = (await message(bookingId, 'confirmation'))?.twilio_sid ?? '';

			expect((await statusCallback(sid, 'sent')).status).toBe(204);
			expect((await message(bookingId, 'confirmation'))?.delivery_status).toBe('sent');

			expect((await statusCallback(sid, 'delivered')).status).toBe(204);
			const delivered = await message(bookingId, 'confirmation');
			expect(delivered?.delivery_status).toBe('delivered');
			expect(delivered?.delivered_at).not.toBeNull();

			await statusCallback(sid, 'sent');
			expect((await message(bookingId, 'confirmation'))?.delivery_status).toBe('delivered');

			await pool.query(
				`update public.scheduled_messages set delivered_at = '2025-01-01Z' where twilio_sid = $1`,
				[sid],
			);
			await statusCallback(sid, 'delivered');
			expect((await message(bookingId, 'confirmation'))?.delivered_at?.toISOString()).toBe(
				'2025-01-01T00:00:00.000Z',
			);
		});
	});
});
