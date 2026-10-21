import { expect, test } from '@playwright/test';

test('landing page explains the product and links to sign-up', async ({ page }) => {
	await page.goto('/');
	await expect(page).toHaveTitle(/^Fullcut/);
	await expect(
		page.getByRole('heading', { level: 1, name: 'Fill your chair. Keep your clients.' }),
	).toBeVisible();
	for (const name of [
		'Spots no-shows before they happen',
		'Refills cancelled slots for you',
		'Your booking page, not a marketplace',
	]) {
		await expect(page.getByRole('heading', { level: 3, name })).toBeVisible();
	}
	await expect(page.getByRole('heading', { level: 2, name: 'Free during the beta' })).toBeVisible();

	const images = page.getByRole('main').getByRole('img');
	await expect(images).toHaveCount(3);
	for (const image of await images.all()) {
		await image.scrollIntoViewIfNeeded();
		await expect
			.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth))
			.toBeGreaterThan(0);
	}

	await page.getByRole('main').getByRole('link', { name: 'Set up your shop free' }).first().click();
	await expect(page).toHaveURL(/\/signup$/);
});

test('serves an Open Graph image', async ({ request }) => {
	const res = await request.get('/opengraph-image');
	expect(res.status()).toBe(200);
	expect(res.headers()['content-type']).toContain('image/png');
});
