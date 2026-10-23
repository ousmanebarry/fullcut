// Captures landing-page screenshots from the local demo shop into public/screenshots/.
// Needs `pnpm dev`, local Supabase and, for risk badges, the ML service plus ML_* and JOBS_SECRET in
// .env.local. Usage (from apps/web): node scripts/screenshots.mjs
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from '@playwright/test';
import { baseUrl, isoDate, prepareDemo, scoreUpcomingBookings } from './lib/local-demo.mjs';

const outDir = new URL('../public/screenshots/', import.meta.url);
const out = (name) => fileURLToPath(new URL(name, outDir));

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
