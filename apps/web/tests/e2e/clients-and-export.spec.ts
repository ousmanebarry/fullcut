import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';
import pg from 'pg';
import { expect, test, type Page } from '@playwright/test';
import { createTestOwner, createTestShop, type TestShop } from './helpers/public-shop';

const NAVIGATION = { timeout: 20_000 };
const dbUrl =
	process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:55322/postgres';

async function signIn(page: Page, credentials: { email: string; password: string }) {
	await page.goto('/login');
	await page.getByLabel('Email').fill(credentials.email);
	await page.getByLabel('Password').fill(credentials.password);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await expect(page).toHaveURL(/\/dashboard$/, NAVIGATION);
}

/** A regular client with two past beard trims, so "Book again" has something to learn from. */
async function addRegular(shop: TestShop): Promise<{ beardId: string }> {
	const client = new pg.Client({ connectionString: dbUrl });
	await client.connect();
	try {
		const { rows } = await client.query<{ id: string }>(
			`select id from public.services where shop_id = $1 and name = 'Beard trim'`,
			[shop.id],
		);
		const beardId = rows[0]?.id ?? '';
		const { rows: clients } = await client.query<{ id: string }>(
			`insert into public.clients (shop_id, name, phone_e164) values ($1, 'Pat Regular', '+14165550142') returning id`,
			[shop.id],
		);
		await client.query(
			`insert into public.bookings (shop_id, staff_id, client_id, service_id, starts_at, ends_at, blocked_until, status, price_cents)
			 select $1, $2, $3, $4, t, t + interval '20 minutes', t + interval '20 minutes', 'completed', 2000
			 from unnest(array[timestamptz '2025-05-06 15:00Z', timestamptz '2025-06-03 15:00Z']) t`,
			[shop.id, shop.staffIds[0], clients[0]?.id, beardId],
		);
		return { beardId };
	} finally {
		await client.end();
	}
}

test.describe('clients and export', () => {
	let shop: TestShop;

	test.afterEach(async () => {
		await shop?.cleanup();
	});

	test('find a client, note, book again, export, delete', async ({ page }) => {
		shop = await createTestShop(['Alex']);
		const { beardId } = await addRegular(shop);
		await signIn(page, await createTestOwner(shop));

		await page
			.getByRole('navigation', { name: 'Main' })
			.getByRole('link', { name: 'Clients' })
			.click();
		await page.getByLabel('Name or phone').fill('(416) 555-0142');
		await page.getByLabel('Name or phone').press('Enter');
		await page.getByRole('link', { name: 'Pat Regular' }).click();
		await expect(page.getByRole('heading', { name: 'Pat Regular' })).toBeVisible(NAVIGATION);
		await expect(page.getByText('28 days')).toBeVisible();

		await page.getByLabel('Add a note').fill('#2 fade, likes it short on top');
		await page.getByRole('button', { name: 'Add note' }).click();
		await expect(page.getByTestId('client-note')).toContainText('#2 fade, likes it short on top');

		await page.getByRole('link', { name: 'Book again' }).click();
		const sheet = page.getByRole('dialog', { name: 'New booking' });
		await expect(sheet.getByText('Pat Regular')).toBeVisible(NAVIGATION);
		await expect(sheet.getByLabel('Service')).toHaveValue(beardId);
		await page.keyboard.press('Escape');

		await page.goto('/dashboard/settings/export');
		const download = page.waitForEvent('download');
		await page.getByRole('button', { name: 'Export all data' }).click();
		const file = await download;
		expect(file.suggestedFilename()).toBe(
			`fullcut-export-${shop.slug}-${new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto' }).format(new Date())}.zip`,
		);
		const zip = unzipSync(await readFile(await file.path()));
		const clientsCsv = new TextDecoder().decode(zip['clients.csv']);
		expect(clientsCsv).toContain('Pat Regular');
		expect(new TextDecoder().decode(zip['client_notes.csv'])).toContain('likes it short on top');

		await page.goto('/dashboard/clients');
		await page.getByRole('link', { name: 'Pat Regular' }).click();
		await page.getByRole('button', { name: 'Delete client data' }).click();
		await page.getByRole('alertdialog').getByRole('button', { name: 'Delete data' }).click();
		await expect(page.getByRole('heading', { name: 'Deleted client' })).toBeVisible();
		await expect(page.getByText(/data was deleted/)).toBeVisible();
	});
});
