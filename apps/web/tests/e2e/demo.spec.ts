import { expect, test } from '@playwright/test';
import pg from 'pg';

// Needs DEMO_* in the env of both the app server and this process (set in CI); skipped otherwise.
const dbUrl =
	process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:55322/postgres';
const demoUserId = process.env.DEMO_USER_ID;
const demoEmail = process.env.DEMO_USER_EMAIL;
const demoSlug = process.env.DEMO_SHOP_SLUG;

test.describe('public demo', () => {
	test.skip(!demoUserId || !demoEmail || !demoSlug, 'DEMO_* env vars are not set');

	test.beforeAll(async () => {
		const db = new pg.Client({ connectionString: dbUrl });
		await db.connect();
		try {
			// Projects run in parallel: a second reset would delete the shop under a running test.
			await db.query("select pg_advisory_lock(hashtextextended('fullcut.e2e_demo_setup', 0))");
			const { rowCount } = await db.query(
				'select 1 from private.demo_config where owner_user_id = $1 and slug = $2',
				[demoUserId, demoSlug],
			);
			if (rowCount) return;

			// The password is left blank: the demo sign-in action sets it.
			await db.query(
				`insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
				   raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
				   confirmation_token, recovery_token, email_change_token_new, email_change)
				 values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, '',
				   now(), '{"provider": "email", "providers": ["email"]}', '{}', now(), now(), '', '', '', '')
				 on conflict (id) do nothing`,
				[demoUserId, demoEmail],
			);
			await db.query(
				`insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
				 values ($1::text, $1::uuid, jsonb_build_object('sub', $1::text, 'email', $2::text), 'email', now(), now())
				 on conflict do nothing`,
				[demoUserId, demoEmail],
			);
			await db.query('select private.configure_demo_shop($1, $2)', [demoUserId, demoSlug]);
		} finally {
			await db.end();
		}
	});

	test('a visitor opens the demo dashboard without signing up', async ({ page }) => {
		await page.goto('/');
		await page.getByRole('button', { name: 'Open the demo dashboard' }).click();
		await expect(page).toHaveURL(/\/dashboard$/);
		await expect(page.getByText('Fullcut Demo Barbers').first()).toBeVisible();
	});

	test('the demo booking page is public', async ({ page }) => {
		await page.goto('/');
		await page.getByRole('link', { name: 'See a booking page' }).click();
		await expect(
			page.getByRole('heading', { level: 1, name: 'Fullcut Demo Barbers' }),
		).toBeVisible();
	});
});
