import { expect, test } from '@playwright/test';

test('home page shows the Fullcut placeholder', async ({ page }) => {
	await page.goto('/');
	await expect(page).toHaveTitle('Fullcut');
	await expect(page.getByRole('heading', { level: 1, name: 'Fullcut' })).toBeVisible();
});
