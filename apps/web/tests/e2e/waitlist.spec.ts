import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import {
	createTestOwner,
	createTestShop,
	tomorrowDayButton,
	torontoDate,
	type TestShop,
} from './helpers/public-shop';
import { enableWaitlist, freedSlotCount, offerFreedSlot } from './helpers/waitlist';

const NAVIGATION = { timeout: 20_000 };

async function openBookingPage(page: Page, slug: string) {
	await page.setExtraHTTPHeaders({ 'x-forwarded-for': `e2e-${randomUUID()}` });
	await page.goto(`/${slug}`);
	await page.waitForLoadState('networkidle');
	await page.getByRole('button', { name: /^Haircut/ }).click();
	await expect(page.getByRole('heading', { level: 2, name: 'Pick a time' })).toBeFocused();
}

test.describe('waitlist refill', () => {
	let shop: TestShop;

	test.afterEach(async () => {
		await shop?.cleanup();
	});

	test('a cancelled slot goes to a waitlisted client who claims it from the text link', async ({
		browser,
	}) => {
		shop = await createTestShop(['Alex']);
		await enableWaitlist(shop.id);

		// Client A books tomorrow at 10:00.
		const clientA = await browser.newPage();
		await openBookingPage(clientA, shop.slug);
		await clientA.getByRole('button', { name: tomorrowDayButton() }).click();
		await clientA.getByRole('button', { name: /, 10:00 AM$/ }).click();
		await clientA.getByLabel('Name').fill('Ava Early');
		await clientA.getByLabel('Mobile number').pressSequentially('4165550161');
		await clientA.getByRole('button', { name: 'Confirm booking' }).click();
		await expect(clientA.getByRole('heading', { level: 2, name: "You're booked" })).toBeVisible();

		// Client B can't find a time and joins the waitlist.
		const clientB = await browser.newPage();
		await openBookingPage(clientB, shop.slug);
		await clientB.getByRole('button', { name: 'Join the waitlist' }).click();
		await expect(
			clientB.getByRole('heading', { level: 2, name: 'Join the waitlist' }),
		).toBeFocused();
		await clientB.getByLabel('Name').fill('Ben Waiting');
		await clientB.getByLabel('Mobile number').fill('4165550162');
		await clientB.getByRole('button', { name: 'Join the waitlist' }).click();
		await expect(clientB.getByText('Tick the box to join the waitlist.')).toBeVisible();
		await clientB.getByRole('checkbox', { name: /Text me when a spot opens/ }).check();
		await clientB.getByRole('button', { name: 'Join the waitlist' }).click();
		await expect(
			clientB.getByRole('heading', { level: 2, name: "You're on the waitlist" }),
		).toBeVisible();

		// Client A cancels from the manage link; the freed slot is queued for the waitlist.
		await clientA.getByRole('link', { name: 'Manage booking' }).click();
		await expect(clientA).toHaveURL(/\/b\/[A-Za-z0-9_-]{43}$/);
		await clientA.getByRole('button', { name: 'Cancel booking' }).click();
		await clientA.getByRole('button', { name: 'Yes, cancel it' }).click();
		await expect(clientA.getByText('Your booking is cancelled.')).toBeVisible();
		await expect.poll(() => freedSlotCount(shop.id)).toBe(1);

		// Client B opens the offer link and books in one tap.
		const token = await offerFreedSlot(shop.id);
		await clientB.goto(`/w/${token}`);
		await expect(
			clientB.getByRole('heading', { level: 1, name: 'A spot opened up' }),
		).toBeVisible();
		await clientB.getByRole('button', { name: 'Book it' }).click();
		await expect(clientB.getByRole('heading', { level: 1, name: "You're booked" })).toBeVisible();
		await expect(clientB.getByRole('link', { name: 'Manage booking' })).toBeVisible();

		// Opening the link again doesn't book twice.
		await clientB.reload();
		await expect(
			clientB.getByRole('heading', { level: 1, name: 'This spot is gone' }),
		).toBeVisible();

		// The owner sees the refilled booking on the calendar.
		const owner = await browser.newPage();
		const credentials = await createTestOwner(shop);
		await owner.goto('/login');
		await owner.getByLabel('Email').fill(credentials.email);
		await owner.getByLabel('Password').fill(credentials.password);
		await owner.getByRole('button', { name: 'Sign in' }).click();
		await expect(owner).toHaveURL(/\/dashboard$/, NAVIGATION);
		// The metric counts this calendar month; tomorrow may already be next month.
		if (torontoDate(1).slice(0, 7) === torontoDate(0).slice(0, 7)) {
			await expect(owner.getByTestId('refill-metric')).toContainText('1');
		}

		await owner.goto(`/dashboard/calendar?date=${torontoDate(1)}`);
		const block = owner.getByRole('button', {
			name: /^Ben Waiting,?\s*Haircut.*refilled from waitlist$/i,
		});
		await expect(block).toBeVisible();
		await block.click();
		await expect(
			owner.getByRole('dialog', { name: 'Ben Waiting' }).getByTestId('refill-badge'),
		).toBeVisible();
	});
});
