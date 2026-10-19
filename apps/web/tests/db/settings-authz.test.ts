import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '@/lib/database.types';
import { defaultWeeklyHours } from '@/lib/shop/hours';
import {
	NOT_FOUND,
	OWNER_ONLY,
	createService,
	deleteTimeOff,
	moveService,
	replaceStaffHours,
	updateService,
	updateShopProfile,
	type Actor,
	type Db,
} from '@/lib/shop/settings';
import { dbUrl, localSupabaseApi } from './local-supabase';

// Calls the settings mutations with real signed-in clients, so both the app-level guards and RLS are exercised.

const PASSWORD = 'authz-test-password';
const id = {
	shopA: randomUUID(),
	shopB: randomUUID(),
	ownerA: randomUUID(),
	staffUserA: randomUUID(),
	ownerB: randomUUID(),
	staffA: randomUUID(),
	staffA2: randomUUID(),
	staffB: randomUUID(),
	serviceA: randomUUID(),
	serviceA2: randomUUID(),
	serviceB: randomUUID(),
	timeOffB: randomUUID(),
};
const emailOf = (userId: string) => `authz-${userId}@test.example.com`;

const admin = new pg.Client({ connectionString: dbUrl });
let ownerA: Db;
let staffA: Db;

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

async function servicePrice(serviceId: string): Promise<number> {
	const { rows } = await admin.query<{ price_cents: number }>(
		'select price_cents from public.services where id = $1',
		[serviceId],
	);
	return rows[0]?.price_cents ?? -1;
}

const actorA: Actor = { shopId: id.shopA, role: 'owner', staffId: id.staffA };
const staffActorA: Actor = { shopId: id.shopA, role: 'staff', staffId: id.staffA2 };
const service = { name: 'Hacked', durationMinutes: 30, bufferMinutes: 0, price: 1 };

describe('settings authorization (app guards + RLS)', () => {
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
			   ($1, 'Authz A', $3, 'America/Toronto'), ($2, 'Authz B', $4, 'America/Toronto')`,
			[id.shopA, id.shopB, `authz-a-${id.shopA}`, `authz-b-${id.shopB}`],
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
			`insert into public.services (id, shop_id, name, duration_minutes, price_cents, sort_order) values
			   ($1, $4, 'Cut A', 30, 3000, 0), ($2, $4, 'Beard A', 20, 2000, 1), ($3, $5, 'Cut B', 30, 3000, 0)`,
			[id.serviceA, id.serviceA2, id.serviceB, id.shopA, id.shopB],
		);
		await admin.query(
			`insert into public.time_off (id, shop_id, staff_id, starts_at, ends_at)
			 values ($1, $2, $3, '2031-01-01T15:00Z', '2031-01-01T20:00Z')`,
			[id.timeOffB, id.shopB, id.staffB],
		);

		[ownerA, staffA] = await Promise.all([
			signedInClient(id.ownerA),
			signedInClient(id.staffUserA),
		]);
	});

	afterAll(async () => {
		await admin.query('delete from public.shops where id = any($1)', [[id.shopA, id.shopB]]);
		await admin.query('delete from auth.users where id = any($1)', [
			[id.ownerA, id.staffUserA, id.ownerB],
		]);
		await admin.end();
	});

	describe('changing ids in requests', () => {
		it("owner A cannot edit shop B's service by id", async () => {
			expect(await updateService(ownerA, actorA, id.serviceB, { price: 1 })).toEqual({
				ok: false,
				error: NOT_FOUND,
			});
			expect(await servicePrice(id.serviceB)).toBe(3000);
		});

		it("owner A cannot edit shop B's service even with a forged shop id", async () => {
			const forged: Actor = { ...actorA, shopId: id.shopB };
			expect(await updateService(ownerA, forged, id.serviceB, { price: 1 })).toEqual({
				ok: false,
				error: NOT_FOUND,
			});
			expect(await servicePrice(id.serviceB)).toBe(3000);
		});

		it('owner A cannot add a service to shop B with a forged shop id', async () => {
			const result = await createService(ownerA, { ...actorA, shopId: id.shopB }, service);
			expect(result.ok).toBe(false);
			const { rows } = await admin.query(
				'select 1 from public.services where shop_id = $1 and name = $2',
				[id.shopB, service.name],
			);
			expect(rows).toHaveLength(0);
		});

		it('owner A cannot rename shop B, reorder its services or delete its time off', async () => {
			const profile = {
				name: 'Pwned',
				slug: `pwned-${id.shopB}`,
				timezone: 'America/Toronto',
				currency: 'CAD',
				phone: null,
				address: null,
				aboutText: null,
				logoUrl: null,
			};
			expect(await updateShopProfile(ownerA, { ...actorA, shopId: id.shopB }, profile)).toEqual({
				ok: false,
				error: NOT_FOUND,
			});
			expect(await moveService(ownerA, actorA, id.serviceB, 'down')).toEqual({
				ok: false,
				error: NOT_FOUND,
			});
			expect(await deleteTimeOff(ownerA, actorA, id.timeOffB)).toEqual({
				ok: false,
				error: NOT_FOUND,
			});
			expect(await deleteTimeOff(ownerA, { ...actorA, shopId: id.shopB }, id.timeOffB)).toEqual({
				ok: false,
				error: NOT_FOUND,
			});

			const { rows } = await admin.query('select name from public.shops where id = $1', [id.shopB]);
			expect(rows[0]?.name).toBe('Authz B');
		});

		it("owner A cannot replace shop B staff's hours", async () => {
			expect(await replaceStaffHours(ownerA, actorA, id.staffB, defaultWeeklyHours())).toEqual({
				ok: false,
				error: NOT_FOUND,
			});
		});
	});

	describe('staff role', () => {
		it('is stopped by the app before owner-only writes', async () => {
			expect(await updateService(staffA, staffActorA, id.serviceA, { price: 1 })).toEqual({
				ok: false,
				error: OWNER_ONLY,
			});
			expect(await createService(staffA, staffActorA, service)).toEqual({
				ok: false,
				error: OWNER_ONLY,
			});
		});

		it('is stopped by RLS even if the app check were bypassed', async () => {
			const forgedOwner: Actor = { ...staffActorA, role: 'owner' };
			expect(await updateService(staffA, forgedOwner, id.serviceA, { price: 1 })).toEqual({
				ok: false,
				error: NOT_FOUND,
			});
			expect((await createService(staffA, forgedOwner, service)).ok).toBe(false);
			expect(await servicePrice(id.serviceA)).toBe(3000);

			const hours = await replaceStaffHours(staffA, forgedOwner, id.staffA, defaultWeeklyHours());
			expect(hours).toEqual({
				ok: false,
				error: { message: 'You can only change your own hours.' },
			});
		});

		it('can replace their own hours but not a colleague’s', async () => {
			expect(
				await replaceStaffHours(staffA, staffActorA, id.staffA2, defaultWeeklyHours()),
			).toEqual({
				ok: true,
				value: null,
			});
			const { rows } = await admin.query(
				'select count(*)::int as n from public.availability_rules where staff_id = $1',
				[id.staffA2],
			);
			expect(rows[0]?.n).toBe(5);

			expect(
				(await replaceStaffHours(staffA, staffActorA, id.staffA, defaultWeeklyHours())).ok,
			).toBe(false);
		});
	});
});
