import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { POST as claimRoute } from '@/app/api/waitlist/claim/route';
import type { MessageSender, OutgoingSms } from '@/lib/messaging/sender';
import { STATUS_CALLBACK_PATH } from '@/lib/messaging/webhooks';
import { runMessageBatch } from '@/lib/messaging/worker';
import { hashToken } from '@/lib/public-booking/links';
import type { BookingCreated, PublicApiError } from '@/lib/public-booking/types';
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
import { runWaitlistBatch } from '@/lib/waitlist/refill';
import { dbUrl, useLocalSupabaseEnv } from './local-supabase';

// Freed slot → offers in waves → texts → claims, against the local stack with a fake sender.

const BASE_URL = 'https://fullcut.test';

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

const dayZone = timeZone(zoneWhereHour((h) => h >= 11 && h <= 17));
const nightZone = timeZone(zoneWhereHour((h) => h >= 23 || h <= 3));

const id = {
	day: randomUUID(),
	night: randomUUID(),
	staff: randomUUID(),
	nightStaff: randomUUID(),
	service: randomUUID(),
	nightService: randomUUID(),
};

const pool = new pg.Client({ connectionString: dbUrl });
let db: Db;

let phoneCounter = 0;
// +1 647 555 03xx: valid for libphonenumber, distinct from the other suites' numbers.
const nextPhone = () => `+164755503${String(phoneCounter++).padStart(2, '0')}`;
// Each scenario gets its own day so freed slots never overlap.
let dayCounter = 2;
const nextDayAt = (hour: number) =>
	zonedToInstant(
		plusDays(localDateOf(Date.now() as Instant, dayZone), dayCounter++),
		hour * 60,
		dayZone,
	);

async function addClient(shop: string = id.day): Promise<{ id: string; phone: string }> {
	const phone = nextPhone();
	const { rows } = await pool.query<{ id: string }>(
		`insert into public.clients (shop_id, name, phone_e164) values ($1, 'Wait Lister', $2) returning id`,
		[shop, phone],
	);
	return { id: rows[0]?.id ?? '', phone };
}

async function addBooking(
	clientId: string,
	startsAt: Instant,
	opts: { shop?: string; staff?: string; service?: string } = {},
) {
	const { rows } = await pool.query<{ id: string }>(
		`insert into public.bookings (shop_id, staff_id, client_id, service_id, starts_at, ends_at, blocked_until, status, price_cents)
		 values ($1, $2, $3, $4, $5, $5::timestamptz + interval '30 minutes', $5::timestamptz + interval '30 minutes', 'confirmed', 3000)
		 returning id`,
		[
			opts.shop ?? id.day,
			opts.staff ?? id.staff,
			clientId,
			opts.service ?? id.service,
			instantToIso(startsAt),
		],
	);
	return rows[0]?.id ?? '';
}

async function addEntry(
	clientId: string,
	createdAt: Date,
	shop: string = id.day,
	service: string = id.service,
) {
	const { rows } = await pool.query<{ id: string }>(
		`insert into public.waitlist_entries (shop_id, client_id, service_id, earliest_date, latest_date, request_method, created_at)
		 values ($1, $2, $3, current_date - 1, current_date + 30, 'booking_page', $4) returning id`,
		[shop, clientId, service, createdAt],
	);
	return rows[0]?.id ?? '';
}

const cancel = (bookingId: string) =>
	pool.query(
		`update public.bookings set status = 'cancelled', cancelled_by = 'client' where id = $1`,
		[bookingId],
	);

async function freedSlot(bookingId: string) {
	const { rows } = await pool.query<{
		id: string;
		status: string;
		wave: number;
		drop_reason: string | null;
		next_run_at: Date;
	}>(
		'select id, status, wave, drop_reason, next_run_at from public.freed_slots where freed_booking_id = $1',
		[bookingId],
	);
	return rows[0];
}

async function offersFor(bookingId: string) {
	const { rows } = await pool.query<{
		id: string;
		waitlist_entry_id: string;
		status: string;
		wave: number;
	}>(
		`select o.id, o.waitlist_entry_id, o.status, o.wave from public.slot_offers o
		 join public.freed_slots f on f.id = o.freed_slot_id where f.freed_booking_id = $1 order by o.created_at, o.id`,
		[bookingId],
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

const sendTexts = (sender: MessageSender) =>
	runMessageBatch(db, {
		sender,
		siteUrl: BASE_URL,
		statusCallbackUrl: `${BASE_URL}${STATUS_CALLBACK_PATH}`,
	});

const claimTokenIn = (text: string | undefined) =>
	/\/w\/([A-Za-z0-9_-]{43})/.exec(text ?? '')?.[1] ?? '';

const claim = (token: string) =>
	claimRoute(
		new Request('http://localhost/api/waitlist/claim', {
			method: 'POST',
			body: JSON.stringify({ token }),
			headers: { 'content-type': 'application/json' },
		}),
	);

describe('waitlist refill', () => {
	beforeAll(async () => {
		useLocalSupabaseEnv();
		delete process.env.MESSAGING_MODE;
		db = createAdminClient();
		await pool.connect();
		await pool.query(
			`insert into public.shops (id, name, slug, timezone, min_lead_minutes, waitlist_enabled, waitlist_wave_size) values
			   ($1, 'Refill Day', $3, $5, 0, true, 2), ($2, 'Refill Night', $4, $6, 0, true, 2)`,
			[
				id.day,
				id.night,
				`refill-day-${id.day.slice(0, 8)}`,
				`refill-night-${id.night.slice(0, 8)}`,
				dayZone,
				nightZone,
			],
		);
		await pool.query(
			`insert into public.staff (id, shop_id, display_name) values ($1, $3, 'Sam'), ($2, $4, 'Noor')`,
			[id.staff, id.nightStaff, id.day, id.night],
		);
		await pool.query(
			`insert into public.services (id, shop_id, name, duration_minutes, price_cents) values
			   ($1, $3, 'Skin Fade', 30, 3000), ($2, $4, 'Beard Trim', 30, 2000)`,
			[id.service, id.nightService, id.day, id.night],
		);
		await pool.query(
			`insert into public.availability_rules (shop_id, staff_id, weekday, start_time, end_time)
			 select $1::uuid, $2::uuid, d, '00:00'::time, '24:00'::time from generate_series(0, 6) d
			 union all
			 select $3::uuid, $4::uuid, d, '00:00'::time, '24:00'::time from generate_series(0, 6) d`,
			[id.day, id.staff, id.night, id.nightStaff],
		);
	});

	afterAll(async () => {
		await pool.query('delete from public.shops where id = any($1)', [[id.day, id.night]]);
		await pool.end();
	});

	// Every scenario starts with an empty waitlist so earlier entries can't match its slot.
	beforeEach(async () => {
		await pool.query(
			`update public.waitlist_entries set status = 'cancelled' where shop_id = any($1) and status = 'active'`,
			[[id.day, id.night]],
		);
	});

	it('texts matching clients when a slot frees up, and exactly one of two concurrent claims wins', async () => {
		const owner = await addClient();
		const first = await addClient();
		const second = await addClient();
		const bookingId = await addBooking(owner.id, nextDayAt(10));
		const firstEntry = await addEntry(first.id, new Date(Date.now() - 2 * 86_400_000));
		const secondEntry = await addEntry(second.id, new Date(Date.now() - 86_400_000));

		await cancel(bookingId);
		expect((await freedSlot(bookingId))?.status).toBe('pending');

		await runWaitlistBatch(db);
		const offers = await offersFor(bookingId);
		expect(
			Object.fromEntries(offers.map((o) => [o.waitlist_entry_id, [o.status, o.wave]])),
		).toEqual({
			[firstEntry]: ['sent', 1],
			[secondEntry]: ['sent', 1],
		});
		expect((await freedSlot(bookingId))?.status).toBe('offering');

		const fake = capture();
		await sendTexts(fake.sender);
		const [firstText] = fake.to(first.phone);
		const [secondText] = fake.to(second.phone);
		expect(firstText?.body).toMatch(/^Refill Day: a spot opened for Skin Fade with Sam, /);
		expect(firstText?.body).toMatch(/\(until \d{1,2}:\d{2} [AP]M\)$/);

		const { rows: stored } = await pool.query<{ body: string }>(
			'select body from public.scheduled_messages where slot_offer_id = $1',
			[offers[0]?.id],
		);
		expect(stored[0]?.body).toContain('[claim link]');

		const results = await Promise.all([
			claim(claimTokenIn(firstText?.body)),
			claim(claimTokenIn(secondText?.body)),
		]);
		expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
		const loser = results.find((r) => r.status === 409);
		expect(((await loser?.json()) as PublicApiError).error).toBe('offer_closed');
		const winner = (await results.find((r) => r.status === 201)?.json()) as BookingCreated;
		expect(winner.booking.serviceName).toBe('Skin Fade');
		expect(winner.manageUrl).toMatch(/\/b\/[A-Za-z0-9_-]{43}$/);

		const { rows: refills } = await pool.query<{ client_id: string; source: string }>(
			`select client_id, source from public.bookings where shop_id = $1 and source = 'waitlist'
			 and starts_at = (select starts_at from public.bookings where id = $2)`,
			[id.day, bookingId],
		);
		expect(refills).toHaveLength(1);

		const { rows: entries } = await pool.query<{ id: string; status: string }>(
			'select id, status from public.waitlist_entries where id = any($1)',
			[[firstEntry, secondEntry]],
		);
		const winnerClient = refills[0]?.client_id;
		const winnerEntry = winnerClient === first.id ? firstEntry : secondEntry;
		expect(Object.fromEntries(entries.map((e) => [e.id, e.status]))).toEqual({
			[winnerEntry]: 'booked',
			[winnerEntry === firstEntry ? secondEntry : firstEntry]: 'active',
		});
		expect((await freedSlot(bookingId))?.status).toBe('filled');
	});

	it('rejects forged, malformed and reused claim links', async () => {
		expect((await claim('not-a-token')).status).toBe(404);
		expect((await claim('A'.repeat(43))).status).toBe(404);

		const owner = await addClient();
		const waiting = await addClient();
		const bookingId = await addBooking(owner.id, nextDayAt(11));
		await addEntry(waiting.id, new Date());
		await cancel(bookingId);
		await runWaitlistBatch(db);
		const fake = capture();
		await sendTexts(fake.sender);
		const token = claimTokenIn(fake.to(waiting.phone)[0]?.body);

		expect((await claim(token)).status).toBe(201);
		const again = await claim(token);
		expect(again.status).toBe(409);
		expect(await again.json()).toMatchObject({ error: 'offer_closed', reason: 'claimed' });
	});

	it('sends the next wave when nobody claims before the offers expire', async () => {
		const owner = await addClient();
		const waiting = await Promise.all([addClient(), addClient(), addClient()]);
		const bookingId = await addBooking(owner.id, nextDayAt(12));
		for (const [i, client] of waiting.entries()) {
			await addEntry(client.id, new Date(Date.now() - (10 - i) * 3_600_000));
		}
		await cancel(bookingId);

		await runWaitlistBatch(db);
		expect((await offersFor(bookingId)).map((o) => o.wave)).toEqual([1, 1]);

		// Nothing new while the first wave is still open.
		await runWaitlistBatch(db);
		expect(await offersFor(bookingId)).toHaveLength(2);

		await pool.query(
			`update public.slot_offers set expires_at = now() - interval '1 second'
			 where freed_slot_id = (select id from public.freed_slots where freed_booking_id = $1)`,
			[bookingId],
		);
		await pool.query(
			`update public.freed_slots set next_run_at = now() - interval '1 second' where freed_booking_id = $1`,
			[bookingId],
		);
		await runWaitlistBatch(db);
		const offers = await offersFor(bookingId);
		expect(offers.map((o) => [o.status, o.wave])).toEqual([
			['expired', 1],
			['expired', 1],
			['sent', 2],
		]);
		expect((await freedSlot(bookingId))?.wave).toBe(2);
	});

	it('withdraws offers when the slot is booked directly, and the link then shows "taken"', async () => {
		const owner = await addClient();
		const waiting = await addClient();
		const walkIn = await addClient();
		const startsAt = nextDayAt(13);
		const bookingId = await addBooking(owner.id, startsAt);
		await addEntry(waiting.id, new Date());
		await cancel(bookingId);
		await runWaitlistBatch(db);
		const fake = capture();
		await sendTexts(fake.sender);
		const token = claimTokenIn(fake.to(waiting.phone)[0]?.body);

		await addBooking(walkIn.id, startsAt);
		const { rows } = await pool.query<{ status: string }>(
			'select status from public.slot_offers where token_hash = $1',
			[hashToken(token)],
		);
		expect(rows[0]?.status).toBe('withdrawn');
		const response = await claim(token);
		expect(response.status).toBe(409);
		expect(await response.json()).toMatchObject({ reason: 'taken' });
	});

	it('marks a refill exhausted when nobody on the waitlist matches', async () => {
		const owner = await addClient();
		const bookingId = await addBooking(owner.id, nextDayAt(14));
		await cancel(bookingId);
		await runWaitlistBatch(db);
		expect((await freedSlot(bookingId))?.status).toBe('exhausted');
	});

	it('never offers during quiet hours: waits for morning, or drops a slot that morning would miss', async () => {
		const owner = await addClient(id.night);
		const waiting = await addClient(id.night);
		await addEntry(waiting.id, new Date(), id.night, id.nightService);
		const opts = { shop: id.night, staff: id.nightStaff, service: id.nightService };

		const later = await addBooking(owner.id, (Date.now() + 3 * 86_400_000) as Instant, opts);
		const soon = await addBooking(owner.id, (Date.now() + 90 * 60_000) as Instant, opts);
		await cancel(later);
		await cancel(soon);
		await runWaitlistBatch(db);

		const waitingSlot = await freedSlot(later);
		expect(waitingSlot?.status).toBe('pending');
		expect(waitingSlot?.next_run_at.getTime()).toBeGreaterThan(Date.now());
		expect(await freedSlot(soon)).toMatchObject({ status: 'dropped', drop_reason: 'quiet_hours' });
		expect(await offersFor(later)).toHaveLength(0);
	});

	it('does nothing for a shop that turned the waitlist off after the slot was freed', async () => {
		const owner = await addClient();
		const waiting = await addClient();
		await addEntry(waiting.id, new Date());
		const bookingId = await addBooking(owner.id, nextDayAt(15));
		await cancel(bookingId);
		await pool.query('update public.shops set waitlist_enabled = false where id = $1', [id.day]);
		try {
			await runWaitlistBatch(db);
			expect((await freedSlot(bookingId))?.status).toBe('cancelled');
			expect(await offersFor(bookingId)).toHaveLength(0);
		} finally {
			await pool.query('update public.shops set waitlist_enabled = true where id = $1', [id.day]);
		}
	});
});
