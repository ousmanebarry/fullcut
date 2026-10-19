import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const connectionString =
	process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:55322/postgres';
const ATTEMPTS = 10;

const shopId = randomUUID();
const staffId = randomUUID();
const serviceId = randomUUID();
const clientId = randomUUID();

const insertBooking = `
	insert into public.bookings
		(shop_id, staff_id, client_id, service_id, starts_at, ends_at, blocked_until, status, price_cents)
	values ($1, $2, $3, $4, '2030-07-01T15:00:00Z', '2030-07-01T15:30:00Z', '2030-07-01T15:40:00Z', 'confirmed', 3000)
`;

describe('bookings_no_overlap under concurrency', () => {
	const admin = new pg.Client({ connectionString });

	beforeAll(async () => {
		await admin.connect();
		await admin.query(
			`insert into public.shops (id, name, slug, timezone) values ($1, 'Concurrency Test', $2, 'America/Toronto')`,
			[shopId, `concurrency-${shopId}`],
		);
		await admin.query(
			`insert into public.staff (id, shop_id, display_name) values ($1, $2, 'Staff')`,
			[staffId, shopId],
		);
		await admin.query(
			`insert into public.services (id, shop_id, name, duration_minutes, buffer_minutes, price_cents)
			 values ($1, $2, 'Cut', 30, 10, 3000)`,
			[serviceId, shopId],
		);
		await admin.query(`insert into public.clients (id, shop_id, name) values ($1, $2, 'Client')`, [
			clientId,
			shopId,
		]);
	});

	afterAll(async () => {
		await admin.query('delete from public.shops where id = $1', [shopId]);
		await admin.end();
	});

	it(`lets exactly one of ${ATTEMPTS} simultaneous bookings for the same slot succeed`, async () => {
		const connections = Array.from({ length: ATTEMPTS }, () => new pg.Client({ connectionString }));
		await Promise.all(connections.map((c) => c.connect()));

		try {
			// Open every transaction first so all inserts race against each other.
			await Promise.all(connections.map((c) => c.query('begin')));

			const results = await Promise.allSettled(
				connections.map(async (c) => {
					try {
						await c.query(insertBooking, [shopId, staffId, clientId, serviceId]);
						await c.query('commit');
					} catch (error) {
						await c.query('rollback');
						throw error;
					}
				}),
			);

			const fulfilled = results.filter((r) => r.status === 'fulfilled');
			const rejected = results.filter((r) => r.status === 'rejected');

			expect(fulfilled).toHaveLength(1);
			expect(rejected).toHaveLength(ATTEMPTS - 1);
			for (const r of rejected) {
				expect(r.reason).toBeInstanceOf(pg.DatabaseError);
				expect(r.reason).toMatchObject({ code: '23P01', constraint: 'bookings_no_overlap' });
			}

			const { rows } = await admin.query<{ count: string }>(
				'select count(*) from public.bookings where staff_id = $1',
				[staffId],
			);
			expect(rows[0]?.count).toBe('1');
		} finally {
			await Promise.all(connections.map((c) => c.end()));
		}
	});
});
