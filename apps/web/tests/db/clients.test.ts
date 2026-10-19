import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	addClientNote,
	anonymiseClient,
	CLIENT_OWNER_ONLY,
	deleteClientNote,
	mergeClients,
	updateClientContact,
} from '@/lib/clients/mutations';
import { listClients, loadClientProfile } from '@/lib/clients/queries';
import { clientContactSchema, clientListParamsSchema } from '@/lib/clients/schemas';
import type { Database } from '@/lib/database.types';
import { loadShopById, type BookingShop } from '@/lib/public-booking/data';
import type { Actor, Db } from '@/lib/shop/settings';
import type { Instant } from '@/lib/time';
import { dbUrl, localSupabaseApi } from './local-supabase';

// Client book reads and writes with real signed-in clients, so app guards, RLS and constraints apply.

const PASSWORD = 'clients-test-password';
const id = {
	shopA: randomUUID(),
	shopB: randomUUID(),
	ownerA: randomUUID(),
	staffUserA: randomUUID(),
	ownerB: randomUUID(),
	staffA: randomUUID(),
	staffB: randomUUID(),
	cut: randomUUID(),
	beard: randomUUID(),
	cutB: randomUUID(),
	alex: randomUUID(),
	bea: randomUUID(),
	cy: randomUUID(),
	dee: randomUUID(),
	gone: randomUUID(),
	bob: randomUUID(),
};
const emailOf = (userId: string) => `clients-${userId}@test.example.com`;

const admin = new pg.Client({ connectionString: dbUrl });
let ownerA: Db;
let staffA: Db;
let shopA: BookingShop;
let shopB: BookingShop;

const ownerActor: Actor = { shopId: id.shopA, role: 'owner', staffId: id.staffA };
const staffActor: Actor = { shopId: id.shopA, role: 'staff', staffId: null };
const now = () => Date.now() as Instant;
const params = (raw: Record<string, string> = {}) => clientListParamsSchema.parse(raw);

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

async function book(
	clientId: string,
	startsAt: string,
	status: string,
	priceCents = 3000,
	serviceId = id.cut,
	shopId = id.shopA,
	staffId = id.staffA,
) {
	await admin.query(
		`insert into public.bookings (shop_id, staff_id, client_id, service_id, starts_at, ends_at, blocked_until, status, price_cents)
		 values ($1, $2, $3, $4, $5::timestamptz, $5::timestamptz + interval '30 minutes', $5::timestamptz + interval '40 minutes', $6, $7)`,
		[shopId, staffId, clientId, serviceId, startsAt, status, priceCents],
	);
}

async function clientRow(clientId: string) {
	const { rows } = await admin.query<{
		name: string;
		phone_e164: string | null;
		email: string | null;
		anonymised_at: Date | null;
	}>('select name, phone_e164, email, anonymised_at from public.clients where id = $1', [clientId]);
	return rows[0];
}

describe('client book', () => {
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
			   ($1, 'Clients A', $3, 'America/Toronto'), ($2, 'Clients B', $4, 'America/Toronto')`,
			[id.shopA, id.shopB, `clients-a-${id.shopA}`, `clients-b-${id.shopB}`],
		);
		await admin.query(
			`insert into public.staff (id, shop_id, display_name) values ($1, $3, 'Sam'), ($2, $4, 'Other')`,
			[id.staffA, id.staffB, id.shopA, id.shopB],
		);
		await admin.query(
			`insert into public.shop_members (shop_id, user_id, role, staff_id) values
			   ($1, $3, 'owner', $6), ($1, $4, 'staff', null), ($2, $5, 'owner', $7)`,
			[id.shopA, id.shopB, id.ownerA, id.staffUserA, id.ownerB, id.staffA, id.staffB],
		);
		await admin.query(
			`insert into public.services (id, shop_id, name, duration_minutes, price_cents) values
			   ($1, $4, 'Cut', 30, 3000), ($2, $4, 'Beard', 20, 2000), ($3, $5, 'Cut B', 30, 3000)`,
			[id.cut, id.beard, id.cutB, id.shopA, id.shopB],
		);
		await admin.query(
			`insert into public.clients (id, shop_id, name, phone_e164, email) values
			   ($1, $7, 'Alex Archer', '+14165550101', null),
			   ($2, $7, 'Bea Brown', '+14165550102', null),
			   ($3, $7, 'Cy Cole', null, null),
			   ($4, $7, 'Dee Dup', '+14165550104', 'dee@example.com'),
			   ($5, $7, 'Gone Person', '+14165550105', 'gone@example.com'),
			   ($6, $8, 'Bob Other', '+14165550199', null)`,
			[id.alex, id.bea, id.cy, id.dee, id.gone, id.bob, id.shopA, id.shopB],
		);
		await book(id.alex, '2025-01-07T15:00Z', 'completed', 3000);
		await book(id.alex, '2025-02-04T15:00Z', 'completed', 4000);
		await book(id.alex, '2025-03-04T15:00Z', 'completed', 2000, id.beard);
		await book(id.alex, '2025-03-11T15:00Z', 'no_show');
		await book(id.alex, '2025-03-18T15:00Z', 'cancelled');
		await book(id.alex, '2031-01-07T15:00Z', 'confirmed');
		await book(id.bea, '2025-06-01T15:00Z', 'completed');
		await book(id.dee, '2025-04-01T15:00Z', 'completed');
		await book(id.gone, '2025-05-05T15:00Z', 'completed');
		await book(id.bob, '2025-05-05T15:00Z', 'completed', 3000, id.cutB, id.shopB, id.staffB);
		await admin.query(
			`insert into public.client_notes (shop_id, client_id, author_user_id, body) values
			   ($1, $2, $4, 'Likes it short'), ($1, $3, $4, 'Dee note')`,
			[id.shopA, id.alex, id.dee, id.ownerA],
		);

		[ownerA, staffA] = await Promise.all([
			signedInClient(id.ownerA),
			signedInClient(id.staffUserA),
		]);
		const shop = await loadShopById(ownerA, id.shopA);
		if (!shop) throw new Error('shop A not visible to its owner');
		shopA = shop;
		shopB = { ...shop, id: id.shopB };
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

	it('lists clients with visit stats, sorted three ways', async () => {
		const byName = await listClients(staffA, shopA, params());
		expect(byName.rows.map((r) => r.name)).toEqual([
			'Alex Archer',
			'Bea Brown',
			'Cy Cole',
			'Dee Dup',
			'Gone Person',
		]);
		expect(byName.rows[0]).toMatchObject({
			visits: 3,
			noShows: 1,
			lastVisitLabel: 'Mar 4, 2025',
		});
		expect(byName.rows[0]?.nextBookingLabel).toContain('Jan 7');

		const byVisits = await listClients(staffA, shopA, params({ sort: 'visits' }));
		expect(byVisits.rows[0]?.name).toBe('Alex Archer');

		const byLastVisit = await listClients(staffA, shopA, params({ sort: 'last_visit' }));
		expect(byLastVisit.rows.map((r) => r.name)).toEqual([
			'Bea Brown',
			'Gone Person',
			'Dee Dup',
			'Alex Archer',
			'Cy Cole',
		]);
	});

	it('searches by name or by a formatted phone number', async () => {
		const byPhone = await listClients(staffA, shopA, params({ q: '(416) 555-0102' }));
		expect(byPhone.rows.map((r) => r.name)).toEqual(['Bea Brown']);
		const byName = await listClients(staffA, shopA, params({ q: 'bea' }));
		expect(byName.rows.map((r) => r.name)).toEqual(['Bea Brown']);
		expect(byName).toMatchObject({ total: 1, page: 1, pageCount: 1 });
	});

	it('never shows another shop’s clients', async () => {
		const other = await listClients(ownerA, shopB, params());
		expect(other.total).toBe(0);
		expect(
			await loadClientProfile(ownerA, shopA, { ...ownerActor, userId: id.ownerA }, id.bob, now()),
		).toBeNull();
	});

	it('builds a profile with stats, history, notes and the usual booking', async () => {
		const profile = await loadClientProfile(
			staffA,
			shopA,
			{ ...staffActor, userId: id.staffUserA },
			id.alex,
			now(),
		);
		expect(profile?.stats).toEqual({
			visits: 3,
			noShows: 1,
			cancellations: 1,
			totalBookings: 6,
			avgSpendCents: 3000,
			medianIntervalDays: 28,
		});
		expect(profile?.upcoming).toHaveLength(1);
		expect(profile?.past).toHaveLength(5);
		expect(profile?.bookAgain).toEqual({ serviceId: id.cut, staffId: id.staffA });
		expect(profile?.notes).toEqual([
			expect.objectContaining({ body: 'Likes it short', authorName: 'Sam', canDelete: false }),
		]);
	});

	describe('editing contact details', () => {
		it('normalises phone and email', async () => {
			const input = clientContactSchema.parse({
				clientId: id.cy,
				name: ' Cy Cole ',
				phone: '(416) 555-0103',
				email: ' Cy@Example.COM ',
			});
			expect(await updateClientContact(staffA, staffActor, shopA, input)).toEqual({
				ok: true,
				value: null,
			});
			expect(await clientRow(id.cy)).toMatchObject({
				name: 'Cy Cole',
				phone_e164: '+14165550103',
				email: 'cy@example.com',
			});
		});

		it('rejects an invalid number', async () => {
			const input = clientContactSchema.parse({ clientId: id.cy, name: 'Cy Cole', phone: '123' });
			expect(await updateClientContact(staffA, staffActor, shopA, input)).toMatchObject({
				ok: false,
				error: { field: 'phone' },
			});
		});

		it('blocks a number another client has and points to a merge', async () => {
			const input = clientContactSchema.parse({
				clientId: id.cy,
				name: 'Cy Cole',
				phone: '416-555-0104',
			});
			const asStaff = await updateClientContact(staffA, staffActor, shopA, input);
			expect(asStaff).toMatchObject({
				ok: false,
				error: { field: 'phone', duplicate: { id: id.dee, name: 'Dee Dup', totalBookings: 1 } },
			});
			expect(!asStaff.ok && asStaff.error.message).toContain('Ask the owner');

			const asOwner = await updateClientContact(ownerA, ownerActor, shopA, input);
			expect(!asOwner.ok && asOwner.error.message).toContain('Merge them?');
			expect((await clientRow(id.cy))?.phone_e164).toBe('+14165550103');
		});

		it('ignores a number that only exists in another shop', async () => {
			const input = clientContactSchema.parse({
				clientId: id.bea,
				name: 'Bea Brown',
				phone: '416-555-0199',
			});
			expect((await updateClientContact(ownerA, ownerActor, shopA, input)).ok).toBe(true);
		});
	});

	describe('merging', () => {
		const merge = {
			keepId: id.cy,
			mergeId: id.dee,
			name: 'Cy Cole',
			phone: '416-555-0104',
			email: undefined,
		};

		it('is owner-only', async () => {
			expect(await mergeClients(staffA, staffActor, shopA, merge)).toEqual({
				ok: false,
				error: CLIENT_OWNER_ONLY,
			});
			// Even with a forged role, the database refuses.
			const forged = await mergeClients(staffA, { ...staffActor, role: 'owner' }, shopA, merge);
			expect(forged).toMatchObject({
				ok: false,
				error: { message: 'Only the shop owner can merge clients.' },
			});
		});

		it('moves every booking and note and leaves no orphans', async () => {
			expect(await mergeClients(ownerA, ownerActor, shopA, merge)).toEqual({
				ok: true,
				value: { clientId: id.cy },
			});
			const { rows } = await admin.query<{
				orphans: number;
				kept: number;
				gone: number;
				notes: number;
			}>(
				`select
				   (select count(*)::int from public.bookings where client_id = $2) as orphans,
				   (select count(*)::int from public.bookings where client_id = $1) as kept,
				   (select count(*)::int from public.clients where id = $2) as gone,
				   (select count(*)::int from public.client_notes where client_id = $1) as notes`,
				[id.cy, id.dee],
			);
			expect(rows[0]).toEqual({ orphans: 0, kept: 1, gone: 0, notes: 1 });
			expect(await clientRow(id.cy)).toMatchObject({
				phone_e164: '+14165550104',
				email: 'cy@example.com',
			});
			const audit = await admin.query(
				`select actor_user_id from public.audit_events where shop_id = $1 and action = 'client_merge'`,
				[id.shopA],
			);
			expect(audit.rows).toEqual([{ actor_user_id: id.ownerA }]);
		});
	});

	describe('deleting client data', () => {
		it('is owner-only', async () => {
			expect(await anonymiseClient(staffA, staffActor, id.gone)).toEqual({
				ok: false,
				error: CLIENT_OWNER_ONLY,
			});
		});

		it('refuses while the client has upcoming bookings', async () => {
			expect(await anonymiseClient(ownerA, ownerActor, id.alex)).toMatchObject({
				ok: false,
				error: { message: 'Cancel their upcoming bookings first.' },
			});
		});

		it('anonymises the client and keeps their bookings', async () => {
			expect(await anonymiseClient(ownerA, ownerActor, id.gone)).toEqual({ ok: true, value: null });
			const row = await clientRow(id.gone);
			expect(row).toMatchObject({ name: 'Deleted client', phone_e164: null, email: null });
			expect(row?.anonymised_at).not.toBeNull();
			const { rows } = await admin.query('select id from public.bookings where client_id = $1', [
				id.gone,
			]);
			expect(rows).toHaveLength(1);
			const list = await listClients(ownerA, shopA, params());
			expect(list.rows.map((r) => r.name)).not.toContain('Deleted client');
		});
	});

	describe('notes', () => {
		it('lets staff add notes and delete only their own', async () => {
			expect(
				await addClientNote(staffA, staffActor, { clientId: id.bea, body: 'Prefers mornings' }),
			).toEqual({ ok: true, value: null });
			const { rows } = await admin.query<{ id: string; body: string }>(
				'select id, body from public.client_notes where client_id = any($1) order by body',
				[[id.bea, id.alex]],
			);
			const own = rows.find((r) => r.body === 'Prefers mornings');
			const owners = rows.find((r) => r.body === 'Likes it short');
			expect(own && owners).toBeTruthy();

			expect((await deleteClientNote(staffA, staffActor, owners?.id ?? '')).ok).toBe(false);
			expect(await deleteClientNote(staffA, staffActor, own?.id ?? '')).toEqual({
				ok: true,
				value: null,
			});
			expect(await deleteClientNote(ownerA, ownerActor, owners?.id ?? '')).toEqual({
				ok: true,
				value: null,
			});
		});

		it('cannot add notes to a deleted client', async () => {
			expect(
				(await addClientNote(ownerA, ownerActor, { clientId: id.gone, body: 'Hello' })).ok,
			).toBe(false);
		});
	});
});
