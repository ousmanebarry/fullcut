import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import {
	createTestOwner,
	createTestShop,
	tomorrowDayButton,
	torontoDate,
	type TestShop,
} from './helpers/public-shop';

// Needs the local Supabase stack with Realtime running (`pnpm db:start`).

const NAVIGATION = { timeout: 20_000 };
const LIVE = { timeout: 15_000 };

async function signIn(page: Page, credentials: { email: string; password: string }) {
	await page.goto('/login');
	await page.getByLabel('Email').fill(credentials.email);
	await page.getByLabel('Password').fill(credentials.password);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await expect(page).toHaveURL(/\/dashboard$/, NAVIGATION);
}

async function openCalendar(page: Page, date: string) {
	await page.goto(`/dashboard/calendar?date=${date}`);
	await expect(page.getByTestId('calendar-grid')).toBeVisible();
	await page.waitForLoadState('networkidle');
}

async function addBooking(
	page: Page,
	details: { source: 'Phone' | 'Walk-in'; name: string; phone?: string; time: string },
) {
	await page.getByRole('button', { name: 'New booking' }).click();
	const sheet = page.getByRole('dialog', { name: 'New booking' });
	await sheet.getByRole('radio', { name: details.source }).check();
	await sheet.getByLabel('New client name').fill(details.name);
	if (details.phone) await sheet.getByRole('textbox', { name: 'Phone' }).fill(details.phone);
	await sheet.getByLabel('Time', { exact: true }).fill(details.time);
	await sheet.getByRole('button', { name: 'Add booking' }).click();
	await expect(page.getByText('Booking added.')).toBeVisible();
	await expect(sheet).toBeHidden();
}

test.describe('dashboard calendar', () => {
	let shop: TestShop;

	test.afterEach(async () => {
		await shop?.cleanup();
	});

	test('phone booking → calendar → reschedule; walk-in → mark completed', async ({ page }) => {
		shop = await createTestShop(['Alex']);
		await signIn(page, await createTestOwner(shop));

		// Sideways overflow makes mobile Chrome zoom out, and taps then miss their targets.
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
			),
			'the dashboard fits the screen width',
		).toBe(true);

		await openCalendar(page, torontoDate(1));
		await addBooking(page, {
			source: 'Phone',
			name: 'Pat Phone',
			phone: '4165550142',
			time: '10:00',
		});
		const block = page.getByRole('button', { name: 'Pat Phone, Haircut, 10:00 AM – 10:30 AM' });
		await expect(block).toBeVisible();

		await block.click();
		const drawer = page.getByRole('dialog', { name: 'Pat Phone' });
		await expect(drawer.getByRole('link', { name: '+14165550142' })).toHaveAttribute(
			'href',
			'tel:+14165550142',
		);
		await drawer.getByRole('button', { name: 'Reschedule or change' }).click();
		await drawer.getByLabel('Time', { exact: true }).fill('11:00');
		await drawer.getByRole('button', { name: 'Save changes' }).click();
		await expect(page.getByText('Booking updated.')).toBeVisible();
		await expect(drawer.getByText('Haircut · 11:00 AM – 11:30 AM')).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(
			page.getByRole('button', { name: 'Pat Phone, Haircut, 11:00 AM – 11:30 AM' }),
		).toBeVisible();

		// A walk-in recorded after the fact is past its end, so it asks for an outcome.
		await openCalendar(page, torontoDate(-1));
		await addBooking(page, { source: 'Walk-in', name: 'Walt Walkin', time: '10:00' });
		await page.getByRole('button', { name: 'Mark Walt Walkin done' }).click();
		await expect(page.getByText('Walt Walkin: Marked completed.')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Mark Walt Walkin done' })).toHaveCount(0);

		await page.getByRole('button', { name: 'Undo' }).click();
		await expect(page.getByText('Outcome undone.')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Mark Walt Walkin done' })).toBeVisible();

		await page.goto('/dashboard');
		await expect(page.getByText('1 past appointment needs an outcome.')).toBeVisible();
		await page.getByRole('link', { name: 'Mark them' }).click();
		await page.getByRole('button', { name: 'Mark Walt Walkin as no-show' }).click();
		await expect(page.getByText('All caught up.', { exact: false })).toBeVisible();
	});

	test('a booking made on the public page appears live in an open calendar', async ({
		page,
		browser,
	}) => {
		shop = await createTestShop(['Alex']);
		await signIn(page, await createTestOwner(shop));
		await openCalendar(page, torontoDate(1));
		await expect(page.getByTestId('calendar-block')).toHaveCount(0);

		const clientContext = await browser.newContext();
		const client = await clientContext.newPage();
		await client.setExtraHTTPHeaders({ 'x-forwarded-for': `e2e-${randomUUID()}` });
		await client.goto(`/${shop.slug}`);
		await client.waitForLoadState('networkidle');
		await client.getByRole('button', { name: /^Haircut/ }).click();
		await client.getByRole('button', { name: tomorrowDayButton() }).click();
		await client.getByRole('button', { name: /, 2:00 PM$/ }).click();
		await client.getByLabel('Name').fill('Lee Live');
		await client.getByLabel('Mobile number').pressSequentially('4165550143');
		await client.getByRole('button', { name: 'Confirm booking' }).click();
		await expect(client.getByRole('heading', { name: "You're booked" })).toBeVisible();
		await clientContext.close();

		await expect(
			page.getByRole('button', { name: 'Lee Live, Haircut, 2:00 PM – 2:30 PM' }),
		).toBeVisible(LIVE);
	});
});
