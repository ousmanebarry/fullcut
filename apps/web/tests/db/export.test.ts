import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { unzipSync } from 'fflate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '@/lib/database.types';
import { EXPORT_OWNER_ONLY, startExport, type ExportShop } from '@/lib/export';
import { BOM } from '@/lib/export/csv';
import { EXPORT_SOURCES } from '@/lib/export/tables';
import type { Actor, Db } from '@/lib/shop/settings';
import { timeZone } from '@/lib/time';
import { dbUrl, localSupabaseApi } from './local-supabase';

// Full export through real signed-in clients against the seed shop, plus a large synthetic shop.

const SEED = {
	shop: '10000000-0000-4000-8000-000000000001',
	otherShop: '10000000-0000-4000-8000-000000000002',
	owner: '20000000-0000-4000-8000-000000000001',
	ownerEmail: 'owner@demo-barbers.example.com',
	ownerPassword: 'demo-owner-password',
	staffEmail: 'staff@demo-barbers.example.com',
	staffPassword: 'demo-staff-password',
};
const BIG = {
	shop: randomUUID(),
	owner: randomUUID(),
	staff: randomUUID(),
	service: randomUUID(),
	client: randomUUID(),
	password: 'export-test-password',
	bookings: 2345,
};
const bigOwnerEmail = `export-${BIG.owner}@test.example.com`;

const TABLE_FOR_FILE = new Map(EXPORT_SOURCES.map((s) => [s.file, s.table]));
const decoder = new TextDecoder('utf-8', { ignoreBOM: true });

const admin = new pg.Client({ connectionString: dbUrl });
// Taken from the database clock: the Docker clock can lag the host's by a second.
let startedAt: Date;
let owner: Db;
let staff: Db;
let seedShop: ExportShop;

async function signIn(email: string, password: string): Promise<Db> {
	const { url, publishableKey } = localSupabaseApi();
	const client = createClient<Database>(url, publishableKey, {
		auth: { persistSession: false, autoRefreshToken: false },
	});
	const { error } = await client.auth.signInWithPassword({ email, password });
	if (error) throw error;
	return client;
}

async function exportFiles(
	db: Db,
	actor: Actor,
	shop: ExportShop,
): Promise<Record<string, string>> {
	const result = await startExport(db, actor, shop);
	if (!result.ok) throw new Error(result.error.message);
	const zip = new Uint8Array(await new Response(result.value).arrayBuffer());
	return Object.fromEntries(
		Object.entries(unzipSync(zip)).map(([name, bytes]) => [name, decoder.decode(bytes)]),
	);
}

/** Minimal RFC 4180 reader for checking our own output. */
function parseCsv(text: string): Record<string, string>[] {
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = '';
	let quoted = false;
	const body = text.startsWith(BOM) ? text.slice(1) : text;
	for (let i = 0; i < body.length; i++) {
		const ch = body[i];
		if (quoted) {
			if (ch === '"' && body[i + 1] === '"') {
				cell += '"';
				i++;
			} else if (ch === '"') quoted = false;
			else cell += ch;
		} else if (ch === '"') quoted = true;
		else if (ch === ',') {
			row.push(cell);
			cell = '';
		} else if (ch === '\r' && body[i + 1] === '\n') {
			row.push(cell);
			rows.push(row);
			row = [];
			cell = '';
			i++;
		} else cell += ch;
	}
	const [header = [], ...data] = rows;
	return data.map((cells) => Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ''])));
}

async function countFor(table: string, shopId: string): Promise<number> {
	const { rows } = await admin.query<{ n: number }>(
		`select count(*)::int as n from public.${table} where shop_id = $1`,
		[shopId],
	);
	return rows[0]?.n ?? 0;
}

describe('data export', () => {
	beforeAll(async () => {
		await admin.connect();
		const { rows } = await admin.query<{ now: Date }>('select now()');
		startedAt = rows[0]?.now ?? new Date();
		[owner, staff] = await Promise.all([
			signIn(SEED.ownerEmail, SEED.ownerPassword),
			signIn(SEED.staffEmail, SEED.staffPassword),
		]);
		seedShop = {
			id: SEED.shop,
			slug: 'demo-barbers',
			timezone: timeZone('America/Toronto'),
			currency: 'CAD',
		};
	});

	afterAll(async () => {
		await admin.query(
			`delete from public.audit_events where shop_id = $1 and action = 'export' and created_at >= $2`,
			[SEED.shop, startedAt],
		);
		await admin.query('delete from public.bookings where shop_id = $1', [BIG.shop]);
		await admin.query('delete from public.shops where id = $1', [BIG.shop]);
		await admin.query('delete from auth.users where id = $1', [BIG.owner]);
		await admin.end();
	});

	describe('seed shop', () => {
		let files: Record<string, string>;
		const ownerActor: Actor = { shopId: SEED.shop, role: 'owner', staffId: null };

		beforeAll(async () => {
			files = await exportFiles(owner, ownerActor, seedShop);
		});

		it('contains every file, one row per database row', async () => {
			expect(Object.keys(files)).toEqual(EXPORT_SOURCES.map((s) => s.file));
			for (const [file, text] of Object.entries(files)) {
				expect(text.startsWith(BOM), `${file} starts with a BOM`).toBe(true);
				const table = TABLE_FOR_FILE.get(file) ?? '';
				expect(parseCsv(text).length, file).toBe(await countFor(table, SEED.shop));
			}
		});

		it('writes human-readable and re-importable columns', () => {
			const [booking] = parseCsv(files['bookings.csv'] ?? '');
			expect(booking).toMatchObject({
				timezone: 'America/Toronto',
				currency: 'CAD',
				price: expect.stringMatching(/^\d+\.\d{2}$/),
				starts_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/),
				booking_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
				staff_name: expect.stringMatching(/Demo$/),
			});
			const [rule] = parseCsv(files['availability.csv'] ?? '');
			expect(rule?.weekday).toMatch(/day$/);
			expect(rule?.start_time).toMatch(/^\d{2}:\d{2}$/);
		});

		it('never includes another shop’s data', async () => {
			// Seeded client names repeat across shops, so compare ids, phone numbers and shop-specific names.
			const { rows } = await admin.query<{ value: string }>(
				`select id::text as value from public.clients where shop_id = $1
				 union all select phone_e164 from public.clients where shop_id = $1 and phone_e164 is not null
				 union all select id::text from public.bookings where shop_id = $1
				 union all select name from public.services where shop_id = $1
				 union all select display_name from public.staff where shop_id = $1`,
				[SEED.otherShop],
			);
			expect(rows.length).toBeGreaterThan(0);
			const everything = Object.values(files).join('\n');
			const leaked = rows.map((r) => r.value).filter((value) => everything.includes(value));
			expect(leaked).toEqual([]);
		});

		it('logs who exported', async () => {
			const { rows } = await admin.query(
				`select actor_user_id, actor_email from public.audit_events
				 where shop_id = $1 and action = 'export' and created_at >= $2`,
				[SEED.shop, startedAt],
			);
			expect(rows).toContainEqual({ actor_user_id: SEED.owner, actor_email: SEED.ownerEmail });
			const activity = parseCsv(files['activity.csv'] ?? '');
			expect(activity.some((e) => e.action === 'export')).toBe(true);
		});
	});

	it('refuses staff, even with a forged role', async () => {
		const staffActor: Actor = { shopId: SEED.shop, role: 'staff', staffId: null };
		expect(await startExport(staff, staffActor, seedShop)).toEqual({
			ok: false,
			error: EXPORT_OWNER_ONLY,
		});
		const forged = await startExport(staff, { ...staffActor, role: 'owner' }, seedShop);
		expect(forged.ok).toBe(false);
	});

	it('pages through thousands of bookings in time order, across a DST change', async () => {
		await admin.query(
			`insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
			   raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
			   confirmation_token, recovery_token, email_change_token_new, email_change)
			 values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2,
			   extensions.crypt($3, extensions.gen_salt('bf')), now(),
			   '{"provider": "email", "providers": ["email"]}', '{}', now(), now(), '', '', '', '')`,
			[BIG.owner, bigOwnerEmail, BIG.password],
		);
		await admin.query(
			`insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
			 values ($1::text, $1::uuid, jsonb_build_object('sub', $1::text, 'email', $2::text), 'email', now(), now())`,
			[BIG.owner, bigOwnerEmail],
		);
		await admin.query(
			`insert into public.shops (id, name, slug, timezone) values ($1, 'Big Shop', $2, 'America/Toronto')`,
			[BIG.shop, `big-${BIG.shop}`],
		);
		await admin.query(
			`insert into public.staff (id, shop_id, display_name) values ($1, $2, 'Solo')`,
			[BIG.staff, BIG.shop],
		);
		await admin.query(
			`insert into public.shop_members (shop_id, user_id, role, staff_id) values ($1, $2, 'owner', $3)`,
			[BIG.shop, BIG.owner, BIG.staff],
		);
		await admin.query(
			`insert into public.services (id, shop_id, name, duration_minutes, price_cents) values ($1, $2, 'Cut', 30, 3500)`,
			[BIG.service, BIG.shop],
		);
		await admin.query(
			`insert into public.clients (id, shop_id, name) values ($1, $2, '=Formula, "Quoted"')`,
			[BIG.client, BIG.shop],
		);
		await admin.query(
			`insert into public.bookings (shop_id, staff_id, client_id, service_id, starts_at, ends_at, blocked_until, status, price_cents)
			 select $1, $2, $3, $4, t, t + interval '30 minutes', t + interval '30 minutes', 'completed', 3500
			 from generate_series(0, $5 - 1) n, lateral (select timestamptz '2025-01-06 14:00Z' + make_interval(hours => n) as t) s`,
			[BIG.shop, BIG.staff, BIG.client, BIG.service, BIG.bookings],
		);

		const db = await signIn(bigOwnerEmail, BIG.password);
		const files = await exportFiles(
			db,
			{ shopId: BIG.shop, role: 'owner', staffId: BIG.staff },
			{
				id: BIG.shop,
				slug: `big-${BIG.shop}`,
				timezone: timeZone('America/Toronto'),
				currency: 'CAD',
			},
		);
		const bookings = parseCsv(files['bookings.csv'] ?? '');
		expect(bookings).toHaveLength(BIG.bookings);
		expect(new Set(bookings.map((b) => b.booking_id)).size).toBe(BIG.bookings);
		const utc = bookings.map((b) => b.starts_at_utc ?? '');
		expect([...utc].sort()).toEqual(utc);

		expect(bookings[0]).toMatchObject({
			starts_at: '2025-01-06 09:00',
			client_name: `'=Formula, "Quoted"`,
			price: '35.00',
		});
		// 14:00 UTC is 10:00 once Toronto is on daylight time (from March 9, 2025).
		expect(bookings.find((b) => b.starts_at_utc?.startsWith('2025-03-10T14:00'))?.starts_at).toBe(
			'2025-03-10 10:00',
		);
	});
});
