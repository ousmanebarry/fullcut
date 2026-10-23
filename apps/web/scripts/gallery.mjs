// Captures every main screen of the demo shop (public pages, booking flow and dashboard) on desktop and
// phone into docs/media/screens/<theme>/<device>/. Same requirements as screenshots.mjs (`pnpm dev`,
// local Supabase; ML service + JOBS_SECRET for risk badges). Usage (from apps/web):
//   node scripts/gallery.mjs          light theme
//   node scripts/gallery.mjs --dark   dark theme
import { randomInt, randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from '@playwright/test';
import { baseUrl, isoDate, prepareDemo, scoreUpcomingBookings, withDb } from './lib/local-demo.mjs';

const theme = process.argv.includes('--dark') ? 'dark' : 'light';
const rootDir = new URL(`../../../docs/media/screens/${theme}/`, import.meta.url);

const DEVICES = {
	desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
	phone: { ...devices['iPhone 14'], deviceScaleFactor: 2 },
};

// The nightly demo reset has no inbox replies, so add a few for the Inbox screen.
async function addInboxReplies(shopId) {
	await withDb((db) =>
		db.query(
			`insert into public.inbound_messages (shop_id, client_id, twilio_sid, from_phone, body, kind, created_at)
			 select $1::uuid, c.id, 'SMgallery' || m.n || '-' || floor(extract(epoch from now())), c.phone_e164,
			   m.body, 'other', now() - m.age
			 from (values
			   (1, 4, 'Hey, can I move my appointment to later in the day? Running about 20 min behind.', interval '25 minutes'),
			   (2, 9, 'Do you have anything open Saturday morning for a skin fade?', interval '3 hours'),
			   (3, 15, 'Thanks! Also, do you take Apple Pay?', interval '1 day')
			 ) as m (n, client_n, body, age)
			 join public.clients c on c.id = md5($1::text || ':client:' || m.client_n)::uuid`,
			[shopId],
		),
	);
}

async function newContext(browser, device) {
	const context = await browser.newContext({
		...DEVICES[device],
		colorScheme: theme,
		extraHTTPHeaders: { 'x-forwarded-for': `gallery-${randomUUID()}` },
	});
	await context.addInitScript((t) => {
		localStorage.setItem('fullcut.demo-tour.done', '1');
		localStorage.setItem('fullcut:install-hint-dismissed', '1');
		localStorage.setItem('fullcut:theme', t);
	}, theme);
	return context;
}

function shooter(device) {
	let index = 0;
	const dir = new URL(`${device}/`, rootDir);
	// Phones keep to the viewport: full-page shots leave the fixed tab bar floating mid-page.
	return async function shoot(page, name, { fullPage = device !== 'phone' } = {}) {
		await page.waitForLoadState('networkidle');
		await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
		await page.waitForTimeout(300);
		index += 1;
		const file = `${String(index).padStart(2, '0')}-${name}.png`;
		await page.screenshot({ path: fileURLToPath(new URL(file, dir)), fullPage });
		console.log(`[${theme}/${device}] ${file}`);
	};
}

async function capturePublic(browser, device, demo, shoot) {
	const context = await newContext(browser, device);
	const page = await context.newPage();

	await page.goto(`${baseUrl}/`);
	await shoot(page, 'landing');

	// The public page is cached for minutes, so right after a reset it can carry old service ids.
	for (let attempt = 0; ; attempt++) {
		await page.goto(`${baseUrl}/${demo.slug}`);
		await page.getByRole('button', { name: /^Haircut/ }).click();
		await page.getByRole('heading', { level: 2, name: 'Pick a time' }).waitFor();
		await page.waitForLoadState('networkidle');
		const stale = await page.getByText('That service is no longer available.').count();
		if (!stale) break;
		if (attempt === 20) throw new Error('Booking page still serves stale services after 5 min.');
		if (attempt === 0) console.log('Waiting for the public booking page cache to refresh…');
		await page.waitForTimeout(15_000);
	}

	await page.goto(`${baseUrl}/${demo.slug}`);
	await page.getByRole('button', { name: /^Haircut/ }).waitFor();
	await shoot(page, 'booking-services', { fullPage: false });

	await page.getByRole('button', { name: /^Haircut/ }).click();
	await page.getByRole('heading', { level: 2, name: 'Pick a time' }).waitFor();
	await page.waitForLoadState('networkidle');
	const dayWithTimes = page.getByRole('button', { name: /, [1-9]\d* times?$/ }).first();
	if (await dayWithTimes.count()) await dayWithTimes.click();
	await shoot(page, 'booking-times', { fullPage: false });

	await page
		.getByRole('button', { name: /, \d{1,2}:\d{2} [AP]M$/ })
		.first()
		.click();
	await page.getByRole('heading', { level: 2, name: 'Your details' }).waitFor();
	await page.getByLabel('Name').fill('Sam Gallery');
	// A fresh number per run keeps the client under the shop's active-booking limit; the demo clients use 0101-0130.
	await page.getByLabel('Mobile number').pressSequentially(`4165550${200 + randomInt(800)}`);
	await shoot(page, 'booking-details', { fullPage: false });

	await page.getByRole('button', { name: 'Confirm booking' }).click();
	await page.getByRole('heading', { level: 2, name: "You're booked" }).waitFor();
	await shoot(page, 'booking-done', { fullPage: false });

	await page.goto(`${baseUrl}/login`);
	await shoot(page, 'login', { fullPage: false });
	await context.close();
}

async function captureDashboard(browser, device, demo, shoot) {
	const context = await newContext(browser, device);
	const page = await context.newPage();
	const phone = device === 'phone';

	await page.goto(`${baseUrl}/login`);
	await page.getByLabel('Email').fill(demo.email);
	await page.getByLabel('Password').fill(demo.password);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL(/\/dashboard$/, { timeout: 30_000 });
	await shoot(page, 'today');

	await page.goto(`${baseUrl}/dashboard/calendar?date=${isoDate(1)}`);
	await page.waitForLoadState('networkidle');
	await shoot(page, phone ? 'calendar-list' : 'calendar-day');

	const notOurs = { hasNotText: /Free until|Sam Gallery/ };
	const booking = phone
		? page.getByTestId('calendar-agenda').getByRole('button').filter(notOurs)
		: page.getByRole('button', { name: /high no-show risk/ });
	const fallback = page.getByTestId('calendar-block').getByRole('button').filter(notOurs);
	const target = (await booking.count()) ? booking.first() : fallback.first();
	if (await target.count()) {
		await target.click();
		const sheet = page.getByRole('dialog');
		await sheet.waitFor();
		const why = sheet.getByText('Why this rating?');
		if (await why.count()) await why.click();
		await shoot(page, 'booking-drawer', { fullPage: false });
		await page.keyboard.press('Escape');
	}

	if (phone) {
		await page.goto(`${baseUrl}/dashboard/calendar?date=${isoDate(1)}&layout=grid`);
		await shoot(page, 'calendar-grid', { fullPage: false });
	} else {
		await page.goto(`${baseUrl}/dashboard/calendar?view=week&date=${isoDate(1)}`);
		await shoot(page, 'calendar-week');
	}

	await page.goto(`${baseUrl}/dashboard/clients`);
	await shoot(page, 'clients');
	await page.locator('main a[href^="/dashboard/clients/"]:visible').first().click();
	await page.waitForURL(/\/dashboard\/clients\/[0-9a-f-]{36}/);
	await shoot(page, 'client-profile');

	for (const [path, name] of [
		['/dashboard/waitlist', 'waitlist'],
		['/dashboard/inbox', 'inbox'],
		['/dashboard/outcomes', 'outcomes'],
		['/dashboard/settings', 'settings'],
		['/dashboard/settings/no-shows', 'settings-no-shows'],
		['/dashboard/settings/hours', 'settings-hours'],
	]) {
		await page.goto(`${baseUrl}${path}`);
		await shoot(page, name);
	}

	if (phone) {
		await page.goto(`${baseUrl}/dashboard`);
		await page.getByRole('button', { name: 'More' }).click();
		await page.getByRole('dialog', { name: 'More' }).waitFor();
		await shoot(page, 'more-menu', { fullPage: false });
	}
	await context.close();
}

async function capture() {
	await rm(rootDir, { recursive: true, force: true });
	for (const device of Object.keys(DEVICES)) {
		await mkdir(new URL(`${device}/`, rootDir), { recursive: true });
	}

	const demo = await prepareDemo();
	await addInboxReplies(demo.shopId);
	await scoreUpcomingBookings();

	const browser = await chromium.launch();
	try {
		for (const device of Object.keys(DEVICES)) {
			const shoot = shooter(device);
			await capturePublic(browser, device, demo, shoot);
			await captureDashboard(browser, device, demo, shoot);
		}
	} finally {
		await browser.close();
	}
	console.log(`Saved to ${fileURLToPath(rootDir)}`);
}

await capture();
