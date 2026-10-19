import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '@/lib/database.types';
import {
	BOOKING_NOT_FOUND,
	OVERRIDE_OWNER_ONLY,
	changeBookingStatus,
	createManualBooking,
	markOutcomes,
	updateBooking,
} from '@/lib/dashboard/mutations';
import { loadUnmarked, searchClients } from '@/lib/dashboard/queries';
import type { ManualBookingInput } from '@/lib/dashboard/schemas';
import { loadShopById, type BookingShop } from '@/lib/public-booking/data';
import type { Actor, Db } from '@/lib/shop/settings';
import { localDate, type Instant } from '@/lib/time';
import { dbUrl, localSupabaseApi } from './local-supabase';

// Dashboard booking actions with real signed-in clients, so app guards, RLS and constraints all apply.

const PASSWORD = 'dashboard-test-password';
const id = {
	shopA: randomUUID(),
	shopB: randomUUID(),
	ownerA: randomUUID(),
	staffUserA: randomUUID(),
	ownerB: randomUUID(),
	staffA: randomUUID(),
	staffA2: randomUUID(),
	staffB: randomUUID(),
	cut: randomUUID(),
	beard: randomUUID(),
	cutB: randomUUID(),
	clientA: randomUUID(),
	clientB: randomUUID(),
	bookingB: '',
};
const emailOf = (userId: string) => `dashboard-${userId}@test.example.com`;

const admin = new pg.Client({ connectionString: dbUrl });
let ownerA: Db;
let staffA: Db;
let shopA: BookingShop;

const ownerActor: Actor = { shopId: id.shopA, role: 'owner', staffId: id.staffA };
const staffActor: Actor = { shopId: id.shopA, role: 'staff', staffId: id.staffA2 };
const realNow = () => Date.now() as Instant;
// Tuesday 2031-01-07 in Toronto (EST, UTC-5); hours are 09:00–17:00 every day.
const FUTURE = localDate('2031-01-07');

async function signedInClient(userId: string): Promise<Db> {
	const { url, publishableKey } = localSupabaseApi();
	const client = createClient<Database>(url, publishableKey, {
		auth: { persistSession: false, autoRefreshToken: false },
	});
	const { error } = await client.auth.signInWithPassword({
		email: emailOf(userId),
		password: PASSWORD,
	});
	if (error) throw error;
	return client;
}

async function insertBooking(
	staffId: string,
	startsAt: string,
	status = 'confirmed',
	shopId = id.shopA,
	serviceId = id.cut,
	clientId = id.clientA,
): Promise<string> {
	const { rows } = await admin.query<{ id: string }>(
		`insert into public.bookings (shop_id, staff_id, client_id, service_id, starts_at, ends_at, blocked_until, status, price_cents)
		 values ($1, $2, $3, $4, $5::timestamptz, $5::timestamptz + interval '30 minutes', $5::timestamptz + interval '40 minutes', $6, 3000)
		 returning id`,
		[shopId, staffId, clientId, serviceId, startsAt, status],
	);
	return rows[0]?.id ?? '';
}

async function bookingRow(bookingId: string) {
	const { rows } = await admin.query<{
		status: string;
		staff_id: string;
		service_id: string;
		starts_at: Date;
		price_cents: number;
		cancel_reason: string | null;
		outcome_marked_at: Date | null;
		source: string;
	}>('select * from public.bookings where id = $1', [bookingId]);
	return rows[0];
}

const manual = (overrides: Partial<ManualBookingInput>): ManualBookingInput => ({
	source: 'walk_in',
	serviceId: id.cut,
	staffId: id.staffA,
	date: FUTURE,
	time: '10:00',
	overrideHours: false,
	clientName: 'Walk In',
	phone: undefined,
	notes: undefined,
	...overrides,
});

describe('dashboard booking management', () => {
	beforeAll(async () => {
		await admin.connect();
		for (const userId of [id.ownerA, id.staffUserA, id.ownerB]) {
			await admin.query(
				`insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
				   raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
				   confirmation_token, recovery_token, email_change_token_new, email_change)
				 values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2,
				   extensions.crypt($3, extensions.gen_salt('bf')), now(),
				   '{"provider": "email", "providers": ["email"]}', '{}', now(), now(), '', '', '', '')`,
				[userId, emailOf(userId), PASSWORD],
			);
			await admin.query(
				`insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
				 values ($1::text, $1::uuid, jsonb_build_object('sub', $1::text, 'email', $2::text), 'email', now(), now())`,
				[userId, emailOf(userId)],
			);
		}
		await admin.query(
			`insert into public.shops (id, name, slug, timezone) values
			   ($1, 'Dash A', $3, 'America/Toronto'), ($2, 'Dash B', $4, 'America/Toronto')`,
			[id.shopA, id.shopB, `dash-a-${id.shopA}`, `dash-b-${id.shopB}`],
		);
		await admin.query(
			`insert into public.staff (id, shop_id, display_name) values ($1, $4, 'A'), ($2, $4, 'A2'), ($3, $5, 'B')`,
			[id.staffA, id.staffA2, id.staffB, id.shopA, id.shopB],
		);
		await admin.query(
			`insert into public.shop_members (shop_id, user_id, role, staff_id) values
			   ($1, $3, 'owner', $6), ($1, $4, 'staff', $7), ($2, $5, 'owner', $8)`,
			[id.shopA, id.shopB, id.ownerA, id.staffUserA, id.ownerB, id.staffA, id.staffA2, id.staffB],
		);
		await admin.query(
			`insert into public.services (id, shop_id, name, duration_minutes, buffer_minutes, price_cents) values
			   ($1, $4, 'Cut', 30, 10, 3000), ($2, $4, 'Beard', 20, 0, 2000), ($3, $5, 'Cut B', 30, 10, 3000)`,
			[id.cut, id.beard, id.cutB, id.shopA, id.shopB],
		);
		await admin.query(
			`insert into public.availability_rules (shop_id, staff_id, weekday, start_time, end_time)
			 select $1, s, d, '09:00', '17:00' from unnest($2::uuid[]) s, generate_series(0, 6) d`,
			[id.shopA, [id.staffA, id.staffA2]],
		);
		await admin.query(
			`insert into public.clients (id, shop_id, name, phone_e164) values
			   ($1, $3, 'Robin 100% Real', '+15550100200'), ($2, $4, 'Client B', '+15550100300')`,
			[id.clientA, id.clientB, id.shopA, id.shopB],
		);
		id.bookingB = await insertBooking(
			id.staffB,
			'2030-01-08T15:00Z',
			'confirmed',
			id.shopB,
			id.cutB,
			id.clientB,
		);

		[ownerA, staffA] = await Promise.all([
			signedInClient(id.ownerA),
			signedInClient(id.staffUserA),
		]);
		const shop = await loadShopById(ownerA, id.shopA);
		if (!shop) throw new Error('shop A not visible to its owner');
		shopA = shop;
	});

	afterAll(async () => {
		await admin.query('delete from public.bookings where shop_id = any($1)', [
			[id.shopA, id.shopB],
		]);
		await admin.query('delete from public.shops where id = any($1)', [[id.shopA, id.shopB]]);
		await admin.query('delete from auth.users where id = any($1)', [
			[id.ownerA, id.staffUserA, id.ownerB],
		]);
		await admin.end();
	});

	describe('outcomes', () => {
		it('lets a staff member mark a past booking completed and undo it the same day', async () => {
			const bookingId = await insertBooking(id.staffA, '2025-01-08T15:00Z');
			expect(
				await changeBookingStatus(staffA, staffActor, shopA, bookingId, 'markCompleted', realNow()),
			).toEqual({ ok: true, value: 'completed' });
			expect(await bookingRow(bookingId)).toMatchObject({ status: 'completed' });
			expect((await bookingRow(bookingId))?.outcome_marked_at).not.toBeNull();

			expect(
				await changeBookingStatus(staffA, staffActor, shopA, bookingId, 'undoOutcome', realNow()),
			).toEqual({ ok: true, value: 'confirmed' });
			expect(await bookingRow(bookingId)).toMatchObject({
				status: 'confirmed',
				outcome_marked_at: null,
			});
		});

		it('refuses to undo an outcome on a later day', async () => {
			const bookingId = await insertBooking(id.staffA, '2025-01-09T15:00Z');
			await changeBookingStatus(ownerA, ownerActor, shopA, bookingId, 'markNoShow', realNow());
			const twoDaysLater = (Date.now() + 2 * 86_400_000) as Instant;
			const result = await changeBookingStatus(
				ownerA,
				ownerActor,
				shopA,
				bookingId,
				'undoOutcome',
				twoDaysLater,
			);
			expect(result).toMatchObject({ ok: false, error: { message: expect.stringMatching(/day/) } });
			expect(await bookingRow(bookingId)).toMatchObject({ status: 'no_show' });
		});

		it('refuses to mark an appointment that has not started', async () => {
			const bookingId = await insertBooking(id.staffA, '2031-01-07T20:00Z');
			const result = await changeBookingStatus(
				staffA,
				staffActor,
				shopA,
				bookingId,
				'markNoShow',
				realNow(),
			);
			expect(result).toMatchObject({ ok: false });
			expect(await bookingRow(bookingId)).toMatchObject({ status: 'confirmed' });
		});

		it('bulk-marks several bookings', async () => {
			const ids = await Promise.all([
				insertBooking(id.staffA2, '2025-02-01T15:00Z'),
				insertBooking(id.staffA2, '2025-02-01T16:00Z'),
			]);
			expect(await markOutcomes(staffA, staffActor, shopA, ids, 'completed', realNow())).toEqual({
				marked: 2,
				failed: 0,
			});
		});

		it("lists only the staff member's own unmarked bookings when asked", async () => {
			await insertBooking(id.staffA, '2025-03-01T15:00Z');
			const own = await loadUnmarked(staffA, shopA, realNow(), id.staffA2);
			expect(own.bookings.every((b) => b.staffId === id.staffA2)).toBe(true);
			const all = await loadUnmarked(staffA, shopA, realNow());
			expect(all.bookings.some((b) => b.staffId === id.staffA)).toBe(true);
			expect(all.bookings[0]).toMatchObject({ clientName: 'Robin 100% Real', serviceName: 'Cut' });
		});
	});

	describe('cancelling', () => {
		it('records the reason and rejects a second cancel', async () => {
			const bookingId = await insertBooking(id.staffA, '2031-01-08T15:00Z');
			expect(
				await changeBookingStatus(
					staffA,
					staffActor,
					shopA,
					bookingId,
					'cancel',
					realNow(),
					'Sick',
				),
			).toEqual({ ok: true, value: 'cancelled' });
			expect(await bookingRow(bookingId)).toMatchObject({
				status: 'cancelled',
				cancel_reason: 'Sick',
			});
			expect(
				await changeBookingStatus(staffA, staffActor, shopA, bookingId, 'cancel', realNow()),
			).toMatchObject({ ok: false });
		});
	});

	describe('tenant isolation', () => {
		it("cannot touch another shop's booking, even with a forged actor", async () => {
			expect(
				await changeBookingStatus(ownerA, ownerActor, shopA, id.bookingB, 'cancel', realNow()),
			).toEqual({ ok: false, error: BOOKING_NOT_FOUND });
			const forged: Actor = { ...ownerActor, shopId: id.shopB };
			expect(
				await changeBookingStatus(ownerA, forged, shopA, id.bookingB, 'cancel', realNow()),
			).toEqual({ ok: false, error: BOOKING_NOT_FOUND });
			expect(await bookingRow(id.bookingB)).toMatchObject({ status: 'confirmed' });
		});
	});

	describe('manual bookings', () => {
		it('records a walk-in without a phone number', async () => {
			const result = await createManualBooking(
				staffA,
				staffActor,
				shopA,
				manual({ time: '09:00' }),
				realNow(),
			);
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(await bookingRow(result.value.bookingId)).toMatchObject({
				status: 'confirmed',
				source: 'walk_in',
			});
		});

		it('normalises the phone of a phone booking and rejects a bad one', async () => {
			expect(
				await createManualBooking(
					staffA,
					staffActor,
					shopA,
					manual({ source: 'phone', phone: '12', time: '11:00' }),
					realNow(),
				),
			).toMatchObject({ ok: false, error: { field: 'phone' } });

			const result = await createManualBooking(
				staffA,
				staffActor,
				shopA,
				manual({
					source: 'phone',
					phone: '(416) 555-0199',
					clientName: 'Pat Phone',
					time: '11:00',
				}),
				realNow(),
			);
			expect(result.ok).toBe(true);
			const { rows } = await admin.query(
				'select name, phone_e164, first_source from public.clients where shop_id = $1 and phone_e164 = $2',
				[id.shopA, '+14165550199'],
			);
			expect(rows).toEqual([
				{ name: 'Pat Phone', phone_e164: '+14165550199', first_source: 'phone' },
			]);
		});

		it('only lets owners override working hours, and never the overlap rule', async () => {
			const evening = manual({ time: '19:00', overrideHours: true });
			expect(await createManualBooking(staffA, staffActor, shopA, evening, realNow())).toEqual({
				ok: false,
				error: OVERRIDE_OWNER_ONLY,
			});
			expect(
				await createManualBooking(
					staffA,
					staffActor,
					shopA,
					{ ...evening, overrideHours: false },
					realNow(),
				),
			).toMatchObject({ ok: false, error: { field: 'time' } });
			expect((await createManualBooking(ownerA, ownerActor, shopA, evening, realNow())).ok).toBe(
				true,
			);
			expect(
				await createManualBooking(
					ownerA,
					ownerActor,
					shopA,
					{ ...evening, time: '19:15' },
					realNow(),
				),
			).toMatchObject({ ok: false, error: { message: expect.stringMatching(/overlaps/) } });
		});

		it('lets exactly one of two simultaneous bookings for the same time succeed', async () => {
			const input = manual({ time: '14:00', staffId: id.staffA2 });
			const results = await Promise.all([
				createManualBooking(ownerA, ownerActor, shopA, input, realNow()),
				createManualBooking(staffA, staffActor, shopA, input, realNow()),
			]);
			expect(results.filter((r) => r.ok)).toHaveLength(1);
			const loser = results.find((r) => !r.ok);
			expect(loser).toMatchObject({ ok: false, error: { field: 'time' } });
			if (loser && !loser.ok) expect(loser.error.suggestions?.length).toBeGreaterThan(0);
		});
	});

	describe('rescheduling', () => {
		it('moves a booking, changes its service and price, and handles conflicts', async () => {
			const bookingId = await insertBooking(id.staffA2, '2031-01-07T21:00Z'); // 16:00 local
			await insertBooking(id.staffA2, '2031-01-07T16:00Z'); // 11:00 local

			const clash = await updateBooking(
				staffA,
				staffActor,
				shopA,
				{
					bookingId,
					serviceId: id.cut,
					staffId: id.staffA2,
					date: FUTURE,
					time: '11:15',
					overrideHours: false,
				},
				realNow(),
			);
			expect(clash).toMatchObject({ ok: false, error: { field: 'time' } });
			if (!clash.ok) expect(clash.error.suggestions?.length).toBeGreaterThan(0);

			const moved = await updateBooking(
				staffA,
				staffActor,
				shopA,
				{
					bookingId,
					serviceId: id.beard,
					staffId: id.staffA,
					date: FUTURE,
					time: '13:00',
					overrideHours: false,
				},
				realNow(),
			);
			expect(moved.ok).toBe(true);
			const row = await bookingRow(bookingId);
			expect(row).toMatchObject({ staff_id: id.staffA, service_id: id.beard, price_cents: 2000 });
			expect(row?.starts_at.toISOString()).toBe('2031-01-07T18:00:00.000Z');
		});

		it('does not move a booking from another shop', async () => {
			expect(
				await updateBooking(
					ownerA,
					ownerActor,
					shopA,
					{
						bookingId: id.bookingB,
						serviceId: id.cut,
						staffId: id.staffA,
						date: FUTURE,
						time: '09:00',
						overrideHours: false,
					},
					realNow(),
				),
			).toEqual({ ok: false, error: BOOKING_NOT_FOUND });
		});
	});

	describe('client search', () => {
		it('matches names literally and phones by digits, within the shop', async () => {
			expect((await searchClients(staffA, id.shopA, '100%')).map((c) => c.name)).toEqual([
				'Robin 100% Real',
			]);
			expect(await searchClients(staffA, id.shopA, '__')).toEqual([]);
			expect((await searchClients(staffA, id.shopA, '0100 200')).map((c) => c.name)).toEqual([
				'Robin 100% Real',
			]);
			expect(await searchClients(staffA, id.shopA, 'Client B')).toEqual([]);
		});
	});
});
