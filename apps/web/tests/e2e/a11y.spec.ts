import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// Booking-flow steps are scanned in public-booking.spec.ts; this covers every other page.

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const SEED_OWNER = { email: 'owner@demo-barbers.example.com', password: 'demo-owner-password' };

const PUBLIC_PAGES = ['/', '/login', '/signup', '/no-such-page/at-all'];

const DASHBOARD_PAGES = [
	'/dashboard',
	'/dashboard/calendar',
	'/dashboard/clients',
	'/dashboard/waitlist',
	'/dashboard/inbox',
	'/dashboard/outcomes',
	'/dashboard/settings',
	'/dashboard/settings/shop',
	'/dashboard/settings/services',
	'/dashboard/settings/staff',
	'/dashboard/settings/hours',
	'/dashboard/settings/time-off',
	'/dashboard/settings/booking-rules',
	'/dashboard/settings/messages',
	'/dashboard/settings/waitlist',
	'/dashboard/settings/no-shows',
	'/dashboard/settings/export',
];

async function expectNoAxeViolations(page: Page, soft = false) {
	await page.waitForLoadState('networkidle');
	const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
	const found = violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`);
	(soft ? expect.soft(found, page.url()) : expect(found)).toEqual([]);
}

test.describe('accessibility', () => {
	for (const path of PUBLIC_PAGES) {
		test(`no axe violations on ${path}`, async ({ page }) => {
			await page.goto(path);
			await expectNoAxeViolations(page);
		});
	}

	test('no axe violations across the dashboard', async ({ page }) => {
		test.setTimeout(120_000);
		await page.goto('/login');
		await page.getByLabel('Email').fill(SEED_OWNER.email);
		await page.getByLabel('Password').fill(SEED_OWNER.password);
		await page.getByRole('button', { name: 'Sign in' }).click();
		await expect(page).toHaveURL(/\/dashboard$/, { timeout: 20_000 });

		for (const path of DASHBOARD_PAGES) {
			await test.step(path, async () => {
				await page.goto(path);
				await expectNoAxeViolations(page, true);
			});
		}

		await test.step('client profile', async () => {
			await page.goto('/dashboard/clients');
			await page.locator('main table a[href^="/dashboard/clients/"]').first().click();
			await expect(page).toHaveURL(/\/dashboard\/clients\/[0-9a-f-]{36}/);
			await expectNoAxeViolations(page, true);
		});
	});
});
