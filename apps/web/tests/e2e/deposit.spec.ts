import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';
import { createTestShop, tomorrowDayButton, type TestShop } from './helpers/public-shop';

// Real Stripe test mode: needs STRIPE_SECRET_KEY (sk_test_) for the app, `stripe listen` forwarding to
// /api/webhooks/stripe with its whsec_ in STRIPE_WEBHOOK_SECRET, and E2E_STRIPE_ACCOUNT_ID: a test
// connected account that can take charges. Skipped otherwise. Runs on the mobile project only, since
// both tests borrow the same connected account.
const accountId = process.env.E2E_STRIPE_ACCOUNT_ID;
const dbUrl =
	process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:55322/postgres';

test.describe.configure({ mode: 'serial' });

test.describe('booking with a deposit', () => {
	test.skip(
		!accountId || !process.env.STRIPE_SECRET_KEY,
		'E2E_STRIPE_ACCOUNT_ID / STRIPE_SECRET_KEY are not set',
	);
	test.skip(({ isMobile }) => !isMobile, 'deposit flow runs on mobile only');

	let shop: TestShop | undefined;

	test.beforeEach(async () => {
		shop = await createTestShop(['Alex']);
		await sql(
			`update public.shops set stripe_account_id = $2, stripe_charges_enabled = true,
			   deposit_mode = 'all_bookings', deposit_default_type = 'fixed', deposit_default_cents = 1500,
			   free_cancel_hours = 24, late_cancel_keeps_deposit = true
			 where id = $1`,
			[shop.id, accountId],
		);
	});

	test.afterEach(async () => {
		if (!shop) return;
		await sql('delete from public.payments where shop_id = $1', [shop.id]);
		await shop.cleanup();
		shop = undefined;
	});

	test('shows the deposit and policy, takes a test card and confirms the booking', async ({
		page,
	}) => {
		const testShop = shop;
		if (!testShop) throw new Error('no shop');
		await startBooking(page, testShop, '10:00 AM');
		const notice = page.getByRole('region', { name: 'Deposit and cancellation policy' });
		await expect(notice.getByText('Deposit due now: $15.00')).toBeVisible();
		await expect(notice.getByText(/Cancel at least 24 hours before/)).toBeVisible();
		await expect(notice.getByText(/No Fullcut fee/)).toBeVisible();

		await page.getByRole('button', { name: 'Pay $15.00 deposit' }).click();
		await page.waitForURL(/checkout\.stripe\.com/, { timeout: 30_000 });
		await payWithTestCard(page);

		await page.waitForURL(/\/b\/[A-Za-z0-9_-]{43}\?checkout=success$/, { timeout: 60_000 });
		// The webhook may land after the redirect; the page polls until it does.
		await expect(page.getByText('Confirmed')).toBeVisible({ timeout: 30_000 });
		await expect(page.getByText('Deposit paid: $15.00')).toBeVisible();
	});

	test('an abandoned checkout releases the slot once the hold expires', async ({ page }) => {
		const testShop = shop;
		if (!testShop) throw new Error('no shop');
		await startBooking(page, testShop, '2:00 PM');
		await page.getByRole('button', { name: 'Pay $15.00 deposit' }).click();
		await page.waitForURL(/checkout\.stripe\.com/, { timeout: 30_000 });

		await openBookingPage(page, `/${testShop.slug}`);
		await chooseService(page);
		await page.getByRole('button', { name: tomorrowDayButton() }).click();
		await expect(page.getByRole('button', { name: /, 2:00 PM$/ })).toHaveCount(0);

		await sql(
			`update public.bookings set pending_expires_at = now() - interval '1 second'
			 where shop_id = $1 and status = 'pending'`,
			[testShop.id],
		);
		await openBookingPage(page, `/${testShop.slug}`);
		await chooseService(page);
		await page.getByRole('button', { name: tomorrowDayButton() }).click();
		await expect(page.getByRole('button', { name: /, 2:00 PM$/ })).toBeVisible();
	});
});

async function sql(text: string, values: unknown[]) {
	const client = new pg.Client({ connectionString: dbUrl });
	await client.connect();
	try {
		await client.query(text, values);
	} finally {
		await client.end();
	}
}

async function openBookingPage(page: Page, path: string) {
	await page.setExtraHTTPHeaders({ 'x-forwarded-for': `e2e-${randomUUID()}` });
	await page.goto(path);
	await page.waitForLoadState('networkidle');
}

async function chooseService(page: Page) {
	await page.getByRole('button', { name: /^Haircut/ }).click();
	await expect(page.getByRole('heading', { level: 2, name: 'Pick a time' })).toBeFocused();
}

async function startBooking(page: Page, testShop: TestShop, time: string) {
	await openBookingPage(page, `/${testShop.slug}`);
	await chooseService(page);
	await page.getByRole('button', { name: tomorrowDayButton() }).click();
	await page.getByRole('button', { name: new RegExp(`, ${time}$`) }).click();
	await page.getByLabel('Name').fill('Dee Posit');
	await page.getByLabel('Mobile number').pressSequentially('4165550199');
	await page.getByLabel('Email (optional)').fill('dee.posit@example.com');
}

// Stripe-hosted Checkout field ids; see https://docs.stripe.com/testing for test cards.
async function payWithTestCard(page: Page) {
	await page.locator('#cardNumber').fill('4242424242424242');
	await page.locator('#cardExpiry').fill('12 / 34');
	await page.locator('#cardCvc').fill('123');
	await page.locator('#billingName').fill('Dee Posit');
	const postal = page.locator('#billingPostalCode');
	if (await postal.isVisible()) await postal.fill('M5V 2T6');
	await page.getByTestId('hosted-payment-submit-button').click();
}
