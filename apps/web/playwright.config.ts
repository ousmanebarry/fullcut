import { defineConfig, devices } from '@playwright/test';

const PORT = 3000;
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
	testDir: './tests/e2e',
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	reporter: process.env.CI ? 'github' : 'list',
	use: {
		baseURL,
		trace: 'on-first-retry',
	},
	projects: [
		{ name: 'desktop-chrome', use: { ...devices['Desktop Chrome'] } },
		{ name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
	],
	webServer: {
		// CI tests the production build (run `pnpm build` first) so headers and CSP are exercised.
		command: process.env.CI ? 'pnpm start' : 'pnpm dev',
		url: baseURL,
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
	},
});
