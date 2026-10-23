// Shared setup for the local screenshot scripts: env, a local-only guard and a freshly reset demo shop.
import { randomUUID } from 'node:crypto';
import pg from 'pg';

try {
	process.loadEnvFile('.env.local');
} catch {
	// Fall back to the shell environment.
}

export const baseUrl = process.env.SCREENSHOT_BASE_URL ?? 'http://localhost:3000';
const dbUrl =
	process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:55322/postgres';
const SCREENSHOT_USER_ID = '5c2ee000-0000-4000-8000-000000000001';

// These scripts rewrite a password and reset the demo shop: never point them at a cloud project.
const dbHost = new URL(dbUrl).hostname;
if (
	!['127.0.0.1', 'localhost'].includes(dbHost) ||
	!/^http:\/\/localhost[:/]/.test(`${baseUrl}/`)
) {
	console.error('Refusing to run against a non-local database or app.');
	process.exit(1);
}

export async function withDb(fn) {
	const db = new pg.Client({ connectionString: dbUrl });
	await db.connect();
	try {
		return await fn(db);
	} finally {
		await db.end();
	}
}

/** Resets the demo shop (creating it locally if needed) and returns a one-off login for its owner. */
export async function prepareDemo() {
	return withDb(async (db) => {
		let config = (await db.query('select owner_user_id, slug, shop_id from private.demo_config'))
			.rows[0];
		if (!config) {
			await db.query(
				`insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
				   raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
				   confirmation_token, recovery_token, email_change_token_new, email_change)
				 values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated',
				   'screenshots@demo.example.com', '', now(), '{"provider": "email", "providers": ["email"]}',
				   '{}', now(), now(), '', '', '', '')
				 on conflict (id) do nothing`,
				[SCREENSHOT_USER_ID],
			);
			await db.query('select private.configure_demo_shop($1, $2)', [
				SCREENSHOT_USER_ID,
				'fullcut-demo',
			]);
			config = (await db.query('select owner_user_id, slug, shop_id from private.demo_config'))
				.rows[0];
		}
		await db.query('select private.reset_demo_shop()');

		const password = randomUUID();
		const { rows } = await db.query(
			`update auth.users set encrypted_password = extensions.crypt($2, extensions.gen_salt('bf'))
			 where id = $1 returning email`,
			[config.owner_user_id, password],
		);
		return { slug: config.slug, shopId: config.shop_id, email: rows[0].email, password };
	});
}

/** Runs the jobs tick a few times so upcoming bookings get risk scores (needs the ML service). */
export async function scoreUpcomingBookings() {
	const secret = process.env.JOBS_SECRET;
	if (!secret || !process.env.ML_SERVICE_URL) {
		console.warn('JOBS_SECRET or ML_SERVICE_URL missing: screenshots will have no risk badges.');
		return;
	}
	for (let i = 0; i < 5; i++) {
		const res = await fetch(`${baseUrl}/api/jobs/tick`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${secret}` },
		});
		console.log(`[tick] ${res.status} ${await res.text()}`);
	}
}

export function isoDate(daysAhead) {
	const date = new Date(Date.now() + daysAhead * 86_400_000);
	return date.toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
}
