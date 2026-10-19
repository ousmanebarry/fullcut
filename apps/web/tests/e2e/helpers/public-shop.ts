import { randomUUID } from 'node:crypto';
import pg from 'pg';

const dbUrl =
	process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:55322/postgres';

export interface TestShop {
	slug: string;
	name: string;
	staff: string[];
	cleanup: () => Promise<void>;
}

/**
 * A fresh published shop open 24/7 with no minimum notice, so tests never depend on the time of
 * day they run. Created directly in the local database; removed (with its bookings) by cleanup.
 */
export async function createTestShop(staffNames: string[] = ['Alex']): Promise<TestShop> {
	const shopId = randomUUID();
	const slug = `e2e-${shopId.slice(0, 8)}`;
	const name = `E2E Cuts ${shopId.slice(0, 4)}`;
	const client = new pg.Client({ connectionString: dbUrl });
	await client.connect();
	try {
		await client.query(
			`insert into public.shops (id, name, slug, timezone, min_lead_minutes, address)
			 values ($1, $2, $3, 'America/Toronto', 0, '1 Test Street, Toronto')`,
			[shopId, name, slug],
		);
		await client.query(
			`insert into public.services (shop_id, name, duration_minutes, buffer_minutes, price_cents, sort_order)
			 values ($1, 'Haircut', 30, 0, 3500, 0), ($1, 'Beard trim', 20, 0, 2000, 1)`,
			[shopId],
		);
		for (const displayName of staffNames) {
			const { rows } = await client.query<{ id: string }>(
				'insert into public.staff (shop_id, display_name) values ($1, $2) returning id',
				[shopId, displayName],
			);
			await client.query(
				`insert into public.availability_rules (shop_id, staff_id, weekday, start_time, end_time)
				 select $1::uuid, $2::uuid, d, '00:00'::time, '24:00'::time from generate_series(0, 6) d`,
				[shopId, rows[0]?.id],
			);
		}
	} finally {
		await client.end();
	}

	return {
		slug,
		name,
		staff: staffNames,
		cleanup: async () => {
			const c = new pg.Client({ connectionString: dbUrl });
			await c.connect();
			try {
				await c.query('delete from public.shops where id = $1', [shopId]);
			} finally {
				await c.end();
			}
		},
	};
}

/** Accessible name of tomorrow's day-picker button (Toronto), e.g. `Tue 20 October, 95 times`. */
export function tomorrowDayButton(): RegExp {
	const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
	const part = (options: Intl.DateTimeFormatOptions) =>
		new Intl.DateTimeFormat('en-US', { timeZone: 'America/Toronto', ...options }).format(tomorrow);
	return new RegExp(
		`^${part({ weekday: 'short' })}\\s*${part({ day: 'numeric' })}\\s+${part({ month: 'long' })},`,
	);
}
