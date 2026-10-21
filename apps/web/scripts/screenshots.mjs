// Captures landing-page screenshots from the local demo shop into public/screenshots/.
// Needs `pnpm dev`, local Supabase and, for risk badges, the ML service plus ML_* and JOBS_SECRET in
// .env.local. Usage (from apps/web): node scripts/screenshots.mjs
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from '@playwright/test';
import pg from 'pg';

try {
	process.loadEnvFile('.env.local');
} catch {
	// Fall back to the shell environment.
}

const baseUrl = process.env.SCREENSHOT_BASE_URL ?? 'http://localhost:3000';
const dbUrl =
	process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:55322/postgres';
const outDir = new URL('../public/screenshots/', import.meta.url);
const out = (name) => fileURLToPath(new URL(name, outDir));
const SCREENSHOT_USER_ID = '5c2ee000-0000-4000-8000-000000000001';

// This script rewrites a password and resets the demo shop: never point it at a cloud project.
const dbHost = new URL(dbUrl).hostname;
if (
	!['127.0.0.1', 'localhost'].includes(dbHost) ||
	!/^http:\/\/localhost[:/]/.test(`${baseUrl}/`)
) {
	console.error('Refusing to run against a non-local database or app.');
	process.exit(1);
}

async function prepareDemo() {
	const db = new pg.Client({ connectionString: dbUrl });
	await db.connect();
	try {
		let config = (await db.query('select owner_user_id, slug from private.demo_config')).rows[0];
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
			config = (await db.query('select owner_user_id, slug from private.demo_config')).rows[0];
		}
		await db.query('select private.reset_demo_shop()');

		const password = randomUUID();
		const { rows } = await db.query(
			`update auth.users set encrypted_password = extensions.crypt($2, extensions.gen_salt('bf'))
			 where id = $1 returning email`,
			[config.owner_user_id, password],
		);
		return { slug: config.slug, email: rows[0].email, password };
	} finally {
		await db.end();
	}
}

async function scoreUpcomingBookings() {
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

function isoDate(daysAhead) {
	const date = new Date(Date.now() + daysAhead * 86_400_000);
	return date.toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
}

async function shoot(page, name) {
	await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
	await page.screenshot({ path: out(name) });
}

async function capture() {
	await mkdir(outDir, { recursive: true });
	const demo = await prepareDemo();
	await scoreUpcomingBookings();

	const browser = await chromium.launch();
	try {
		const desktop = await browser.newPage({ viewport: { width: 1280, height: 800 } });
		await desktop.addInitScript(() => localStorage.setItem('fullcut.demo-tour.done', '1'));
		await desktop.goto(`${baseUrl}/login`);
		await desktop.getByLabel('Email').fill(demo.email);
		await desktop.getByLabel('Password').fill(demo.password);
		await desktop.getByRole('button', { name: 'Sign in' }).click();
		await desktop.waitForURL(/\/dashboard$/, { timeout: 30_000 });

		let risky = null;
		for (let day = 1; day <= 7 && !risky; day++) {
			await desktop.goto(`${baseUrl}/dashboard/calendar?date=${isoDate(day)}`);
			await desktop.getByTestId('calendar-grid').waitFor();
			await desktop.waitForLoadState('networkidle');
			const button = desktop.getByRole('button', { name: /high no-show risk/ }).first();
			if (await button.count()) risky = button;
		}
		if (risky) {
			await risky.click();
			const sheet = desktop.getByRole('dialog');
			await sheet.waitFor();
			await sheet.getByText('Why this rating?').click();
			await desktop.waitForTimeout(500);
		}
		await shoot(desktop, 'no-show-risk.png');

		await desktop.goto(`${baseUrl}/dashboard/waitlist`);
		await desktop.waitForLoadState('networkidle');
		await shoot(desktop, 'waitlist.png');

		const phone = await browser.newPage({ ...devices['Pixel 7'] });
		// The public page is cached for minutes, so the first view after a reset can carry old service ids.
		const dayWithTimes = phone.getByRole('button', { name: /, [1-9]\d* times?$/ }).first();
		for (let attempt = 0; attempt < 5; attempt++) {
			await phone.goto(`${baseUrl}/${demo.slug}`);
			await phone.getByRole('button', { name: /^Haircut/ }).click();
			await phone.getByRole('heading', { level: 2, name: 'Pick a time' }).waitFor();
			await phone.waitForLoadState('networkidle');
			if (await dayWithTimes.count()) break;
			await phone.waitForTimeout(15_000);
		}
		await dayWithTimes.click();
		await phone.waitForLoadState('networkidle');
		await phone.waitForTimeout(500);
		await shoot(phone, 'booking-page.png');
	} finally {
		await browser.close();
	}
	console.log(`Saved to ${fileURLToPath(outDir)}`);
}

await capture();
