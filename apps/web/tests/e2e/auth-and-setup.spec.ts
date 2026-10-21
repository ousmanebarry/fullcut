import { expect, test, type Page } from '@playwright/test';

// Needs the local Supabase stack (`pnpm db:start`, `pnpm db:reset`) and apps/web/.env.local.

const NAVIGATION = { timeout: 20_000 };

function next(page: Page) {
	return page.getByRole('button', { name: 'Next', exact: true }).click();
}

test('a new owner signs up, sets up their shop and lands on the dashboard', async ({ page }) => {
	const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
	const shopName = `E2E Cuts ${id}`;

	await page.goto('/signup');
	await page.getByLabel('Your name').fill('Riley Tester');
	await page.getByLabel('Email').fill(`owner-${id}@test.example.com`);
	await page.getByLabel('Password').fill('correct-horse-battery');
	await page.getByRole('button', { name: 'Create account' }).click();

	await expect(page).toHaveURL(/\/onboarding$/, NAVIGATION);
	// Retry until hydrated: the slug only follows the name once React is running.
	await expect(async () => {
		await page.getByLabel('Shop name').fill(shopName);
		await expect(page.getByLabel('Booking link')).toHaveValue(`e2e-cuts-${id}`, { timeout: 1_000 });
	}).toPass(NAVIGATION);
	await next(page);

	await expect(page.getByRole('heading', { name: 'Where you work' })).toBeVisible();
	await expect(page.getByLabel('Timezone')).not.toHaveValue('');
	await next(page);

	await expect(page.getByLabel('Name clients will see')).toHaveValue('Riley Tester');
	await next(page);

	await next(page);
	await expect(page.getByText('Enter a service name.')).toBeVisible();
	await page.getByLabel('Name', { exact: true }).fill('Haircut');
	await page.getByLabel('Price (CAD)').fill('35');
	await next(page);

	await expect(page.getByRole('heading', { name: 'When you work' })).toBeVisible();
	await page.getByRole('button', { name: 'Create my shop' }).click();

	await expect(page).toHaveURL(/\/dashboard$/, NAVIGATION);
	await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
	await expect(page.getByRole('banner').getByText(shopName)).toBeVisible();

	await page.goto('/dashboard/settings/services');
	await expect(page.getByLabel('Name').first()).toHaveValue('Haircut');
	await expect(page.getByLabel('Price (CAD)').first()).toHaveValue('35.00');
});

test('signed-out visitors are sent to login and back', async ({ page }) => {
	await page.goto('/dashboard/settings/hours');
	await expect(page).toHaveURL(/\/login\?next=%2Fdashboard%2Fsettings%2Fhours$/, NAVIGATION);

	await page.getByLabel('Email').fill('owner@demo-barbers.example.com');
	await page.getByLabel('Password').fill('demo-owner-password');
	await page.getByRole('button', { name: 'Sign in' }).click();
	await expect(page).toHaveURL(/\/dashboard\/settings\/hours/, NAVIGATION);
});

test('a staff-role member only reaches their own schedule settings', async ({ page }) => {
	await page.goto('/login');
	await page.getByLabel('Email').fill('staff@demo-barbers.example.com');
	await page.getByLabel('Password').fill('demo-staff-password');
	await page.getByRole('button', { name: 'Sign in' }).click();
	await expect(page).toHaveURL(/\/dashboard$/, NAVIGATION);

	await page.goto('/dashboard/settings');
	const sections = page.getByRole('main').getByRole('list').last();
	await expect(sections.getByRole('link', { name: /Hours/ })).toBeVisible();
	await expect(sections.getByRole('link', { name: /Time off/ })).toBeVisible();
	await expect(sections.getByRole('link', { name: /Services/ })).toHaveCount(0);

	await page.goto('/dashboard/settings/services');
	await expect(page.getByRole('heading', { level: 1, name: 'Not found' })).toBeVisible();

	await page.goto('/dashboard/settings/hours');
	await expect(page.getByRole('heading', { level: 2, name: 'Jordan Demo' })).toBeVisible();
	await expect(page.getByRole('navigation', { name: 'Staff' })).toHaveCount(0);
});
