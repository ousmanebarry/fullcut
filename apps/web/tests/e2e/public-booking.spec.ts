import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { createTestShop, tomorrowDayButton, type TestShop } from './helpers/public-shop';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function expectNoAxeViolations(page: Page) {
	const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
	expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`)).toEqual([]);
}

// Waits for hydration, so the first keyboard or click event is handled by React. Each page gets its
// own client IP so the per-IP booking limit doesn't carry over between tests.
async function openBookingPage(page: Page, path: string) {
	await page.setExtraHTTPHeaders({ 'x-forwarded-for': `e2e-${randomUUID()}` });
	await page.goto(path);
	await page.waitForLoadState('networkidle');
}

async function chooseService(page: Page, service = 'Haircut') {
	await page.getByRole('button', { name: new RegExp(`^${service}`) }).click();
	await expect(page.getByRole('heading', { level: 2, name: 'Pick a time' })).toBeFocused();
}

async function chooseTomorrowAt(page: Page, time: string) {
	await page.getByRole('button', { name: tomorrowDayButton() }).click();
	await page.getByRole('button', { name: new RegExp(`, ${time}$`) }).click();
	await expect(page.getByRole('heading', { level: 2, name: 'Your details' })).toBeFocused();
}

async function fillDetails(page: Page, name: string, phone: string) {
	await page.getByLabel('Name').fill(name);
	await page.getByLabel('Mobile number').pressSequentially(phone);
}

test.describe('public booking page', () => {
	let shop: TestShop;

	test.afterEach(async () => {
		await shop?.cleanup();
	});

	test('books in three steps and shows a manage link', async ({ page }) => {
		shop = await createTestShop(['Alex', 'Blair']);
		await openBookingPage(page, `/${shop.slug}?src=instagram`);
		await expect(page.getByRole('heading', { level: 1, name: shop.name })).toBeVisible();
		await expectNoAxeViolations(page);

		await chooseService(page);
		await expect(page.getByRole('radio', { name: 'Anyone' })).toBeChecked();
		// The first open day is today, so a fixed time like 10:00 AM may already have passed.
		await expect(
			page.getByRole('button', { name: /, \d{1,2}:\d{2} [AP]M$/ }).first(),
		).toBeVisible();
		await expectNoAxeViolations(page);

		await chooseTomorrowAt(page, '10:00 AM');
		await fillDetails(page, 'Pat Public', '4165550123');
		await expect(page.getByLabel('Mobile number')).toHaveValue('(416) 555-0123');
		await expect(page.getByText('Haircut · 30 min')).toBeVisible();
		await expectNoAxeViolations(page);

		await page.getByRole('button', { name: 'Confirm booking' }).click();
		await expect(page.getByRole('heading', { level: 2, name: "You're booked" })).toBeVisible();
		await expect(page.getByText(/booking reference is [0-9A-F]{8}/)).toBeVisible();
		await expect(page.getByRole('button', { name: 'Add to calendar' })).toBeVisible();
		await expectNoAxeViolations(page);

		const download = page.waitForEvent('download');
		await page.getByRole('button', { name: 'Add to calendar' }).click();
		expect((await download).suggestedFilename()).toMatch(/^booking-[0-9A-F]{8}\.ics$/);

		await page.getByRole('link', { name: 'Manage booking' }).click();
		await expect(page).toHaveURL(/\/b\/[A-Za-z0-9_-]{43}$/);
		await expect(page.getByRole('heading', { level: 1, name: 'Your booking' })).toBeVisible();
		await expect(page.getByText('Confirmed')).toBeVisible();
		await expectNoAxeViolations(page);
	});

	test('shows "just taken" when another client books the same time first', async ({
		page: first,
		browser,
	}) => {
		shop = await createTestShop(['Alex']);
		// A separate browser context: a second client on another device.
		const otherDevice = await browser.newContext({ viewport: first.viewportSize() });
		const second = await otherDevice.newPage();
		for (const page of [first, second]) {
			await openBookingPage(page, `/${shop.slug}`);
			await chooseService(page);
			await chooseTomorrowAt(page, '11:00 AM');
		}

		await fillDetails(first, 'First Client', '4165550124');
		await first.getByRole('button', { name: 'Confirm booking' }).click();
		await expect(first.getByRole('heading', { name: "You're booked" })).toBeVisible();

		await fillDetails(second, 'Second Client', '4165550125');
		await second.getByRole('button', { name: 'Confirm booking' }).click();
		await expect(second.getByText(/That time was just taken/)).toBeVisible();
		const suggestions = second.getByRole('region', { name: 'Nearest open times' });
		await expect(suggestions.getByRole('button').first()).toBeVisible();
		await expectNoAxeViolations(second);

		await suggestions.getByRole('button').first().click();
		await second.getByRole('button', { name: 'Confirm booking' }).click();
		await expect(second.getByRole('heading', { name: "You're booked" })).toBeVisible();

		await otherDevice.close();
	});

	test('cancelling via the manage link frees the slot', async ({ page }) => {
		shop = await createTestShop(['Alex']);
		await openBookingPage(page, `/${shop.slug}`);
		await chooseService(page);
		await chooseTomorrowAt(page, '2:00 PM');
		await fillDetails(page, 'Pat Cancel', '4165550126');
		await page.getByRole('button', { name: 'Confirm booking' }).click();
		await expect(page.getByRole('heading', { name: "You're booked" })).toBeVisible();

		await page.getByRole('link', { name: 'Manage booking' }).click();
		// A full page load: wait for hydration so the Cancel click isn't lost.
		await expect(page).toHaveURL(/\/b\/[A-Za-z0-9_-]{43}$/);
		await page.waitForLoadState('networkidle');
		await page.getByRole('button', { name: 'Cancel booking' }).click();
		await expectNoAxeViolations(page);
		await page.getByRole('button', { name: 'Yes, cancel it' }).click();
		await expect(page.getByText('Cancelled', { exact: true })).toBeVisible();
		await expect(page.getByText('Your booking is cancelled.')).toBeVisible();

		await openBookingPage(page, `/${shop.slug}`);
		await chooseService(page);
		await page.getByRole('button', { name: tomorrowDayButton() }).click();
		await expect(page.getByRole('button', { name: /, 2:00 PM$/ })).toBeVisible();
	});

	test('is keyboard operable and fits a 360px screen', async ({ page }) => {
		shop = await createTestShop(['Alex', 'Blair']);
		await page.setViewportSize({ width: 360, height: 740 });
		await openBookingPage(page, `/${shop.slug}`);

		await page.getByRole('button', { name: /^Haircut/ }).focus();
		await page.keyboard.press('Enter');
		await expect(page.getByRole('heading', { level: 2, name: 'Pick a time' })).toBeFocused();

		const day = page.getByRole('button', { name: tomorrowDayButton() });
		await day.focus();
		await page.keyboard.press('Enter');
		const chip = page.getByRole('button', { name: /, 9:00 AM$/ });
		await chip.focus();
		await page.keyboard.press('Enter');
		await expect(page.getByRole('heading', { level: 2, name: 'Your details' })).toBeFocused();

		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
		);
		expect(overflow).toBeLessThanOrEqual(0);

		await page.keyboard.press('Tab');
		await expect(page.getByRole('button', { name: 'Change time' })).toBeFocused();
	});

	test('unknown shops get a not-found page', async ({ page }) => {
		shop = { id: '', slug: '', name: '', staff: [], staffIds: [], cleanup: async () => {} };
		await page.goto('/no-such-shop-e2e');
		await expect(
			page.getByRole('heading', { name: "This booking page isn't available" }),
		).toBeVisible();
	});
});
