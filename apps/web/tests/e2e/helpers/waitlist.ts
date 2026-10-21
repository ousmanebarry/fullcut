import { createHash, randomBytes } from 'node:crypto';
import pg from 'pg';

const dbUrl =
	process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:55322/postgres';

async function withDb<T>(run: (client: pg.Client) => Promise<T>): Promise<T> {
	const client = new pg.Client({ connectionString: dbUrl });
	await client.connect();
	try {
		return await run(client);
	} finally {
		await client.end();
	}
}

export function enableWaitlist(shopId: string): Promise<void> {
	return withDb(async (c) => {
		await c.query('update public.shops set waitlist_enabled = true where id = $1', [shopId]);
	});
}

/** Whether cancelling queued a freed slot for the shop (the trigger under test). */
export function freedSlotCount(shopId: string): Promise<number> {
	return withDb(async (c) => {
		const { rows } = await c.query<{ n: number }>(
			'select count(*)::int as n from public.freed_slots where shop_id = $1',
			[shopId],
		);
		return rows[0]?.n ?? 0;
	});
}

/**
 * Sends a wave for the shop's freed slot through the same database function the job uses, and returns
 * a claim token for it. Log mode never shows the real token, and the job itself skips quiet hours, so
 * the e2e test drives this step directly (tests/db/waitlist-refill.test.ts covers the job).
 */
export function offerFreedSlot(shopId: string): Promise<string> {
	return withDb(async (c) => {
		const { rows } = await c.query<{
			freed_slot_id: string;
			entry_id: string;
			service_id: string;
			starts_at: Date;
			duration_minutes: number;
			buffer_minutes: number;
		}>(
			`select f.id as freed_slot_id, e.id as entry_id, e.service_id, f.starts_at, s.duration_minutes, s.buffer_minutes
			 from public.freed_slots f
			 join public.waitlist_entries e on e.shop_id = f.shop_id and e.status = 'active'
			 join public.services s on s.id = e.service_id
			 where f.shop_id = $1
			 order by e.created_at
			 limit 1`,
			[shopId],
		);
		const slot = rows[0];
		if (!slot) throw new Error('no freed slot with a waiting client');
		const minutes = (m: number) => new Date(slot.starts_at.getTime() + m * 60_000).toISOString();
		await c.query(
			`select public.create_slot_offers($1, $2::jsonb, now() + interval '15 minutes', now() + interval '15 minutes')`,
			[
				slot.freed_slot_id,
				JSON.stringify([
					{
						entry_id: slot.entry_id,
						service_id: slot.service_id,
						starts_at: slot.starts_at.toISOString(),
						ends_at: minutes(slot.duration_minutes),
						blocked_until: minutes(slot.duration_minutes + slot.buffer_minutes),
					},
				]),
			],
		);
		const token = randomBytes(32).toString('base64url');
		await c.query('update public.slot_offers set token_hash = $1 where freed_slot_id = $2', [
			createHash('sha256').update(token).digest('hex'),
			slot.freed_slot_id,
		]);
		return token;
	});
}
