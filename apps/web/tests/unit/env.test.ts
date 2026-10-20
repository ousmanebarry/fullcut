import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	getJobsSecret,
	getMessagingMode,
	getSiteUrl,
	getStripeSecretKey,
	getStripeWebhookSecrets,
	getTwilioWebhookBaseUrl,
} from '@/lib/env';

describe('getSiteUrl', () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('prefers SITE_URL', () => {
		vi.stubEnv('NODE_ENV', 'production');
		vi.stubEnv('SITE_URL', 'https://fullcut.example.com');
		vi.stubEnv('VERCEL_ENV', 'preview');
		vi.stubEnv('VERCEL_BRANCH_URL', 'fullcut-git-feature-team.vercel.app');
		expect(getSiteUrl()).toBe('https://fullcut.example.com');
	});

	it('falls back to the branch URL on Vercel previews', () => {
		vi.stubEnv('NODE_ENV', 'production');
		vi.stubEnv('SITE_URL', undefined);
		vi.stubEnv('VERCEL_ENV', 'preview');
		vi.stubEnv('VERCEL_BRANCH_URL', 'fullcut-git-feature-team.vercel.app');
		expect(getSiteUrl()).toBe('https://fullcut-git-feature-team.vercel.app');
	});

	it('requires SITE_URL in production', () => {
		vi.stubEnv('NODE_ENV', 'production');
		vi.stubEnv('SITE_URL', undefined);
		vi.stubEnv('VERCEL_ENV', 'production');
		vi.stubEnv('VERCEL_BRANCH_URL', 'fullcut-git-main-team.vercel.app');
		expect(() => getSiteUrl()).toThrow();
	});

	it('uses localhost in development', () => {
		vi.stubEnv('NODE_ENV', 'development');
		vi.stubEnv('SITE_URL', undefined);
		vi.stubEnv('VERCEL_ENV', undefined);
		expect(getSiteUrl()).toBe('http://localhost:3000');
	});
});

describe('messaging env', () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('only sends real texts when MESSAGING_MODE is exactly "twilio"', () => {
		vi.stubEnv('MESSAGING_MODE', undefined);
		expect(getMessagingMode()).toBe('log');
		vi.stubEnv('MESSAGING_MODE', 'TWILIO');
		expect(getMessagingMode()).toBe('log');
		vi.stubEnv('MESSAGING_MODE', 'twilio');
		expect(getMessagingMode()).toBe('twilio');
	});

	it('disables the job endpoint without a long enough secret', () => {
		vi.stubEnv('JOBS_SECRET', undefined);
		expect(getJobsSecret()).toBeNull();
		vi.stubEnv('JOBS_SECRET', 'short');
		expect(getJobsSecret()).toBeNull();
		vi.stubEnv('JOBS_SECRET', 'x'.repeat(32));
		expect(getJobsSecret()).toBe('x'.repeat(32));
	});

	it('takes the webhook base URL from SITE_URL unless overridden', () => {
		vi.stubEnv('NODE_ENV', 'development');
		vi.stubEnv('SITE_URL', 'https://fullcut.example.com');
		vi.stubEnv('TWILIO_WEBHOOK_BASE_URL', '');
		expect(getTwilioWebhookBaseUrl()).toBe('https://fullcut.example.com');
		vi.stubEnv('TWILIO_WEBHOOK_BASE_URL', 'https://tunnel.example.com');
		expect(getTwilioWebhookBaseUrl()).toBe('https://tunnel.example.com');
	});
});

describe('stripe env', () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('is off without a key', () => {
		vi.stubEnv('STRIPE_SECRET_KEY', '');
		expect(getStripeSecretKey()).toBeNull();
	});

	it('accepts test-mode keys', () => {
		vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_abc123');
		expect(getStripeSecretKey()).toBe('sk_test_abc123');
		vi.stubEnv('STRIPE_SECRET_KEY', 'rk_test_abc123');
		expect(getStripeSecretKey()).toBe('rk_test_abc123');
	});

	it('refuses live keys outside a production deploy', () => {
		vi.stubEnv('STRIPE_SECRET_KEY', 'sk_live_abc123');
		vi.stubEnv('VERCEL_ENV', 'preview');
		expect(() => getStripeSecretKey()).toThrow(/test-mode/);
		vi.stubEnv('VERCEL_ENV', undefined);
		expect(() => getStripeSecretKey()).toThrow(/test-mode/);
		vi.stubEnv('VERCEL_ENV', 'production');
		expect(getStripeSecretKey()).toBe('sk_live_abc123');
	});

	it('reads one or more webhook secrets', () => {
		vi.stubEnv('STRIPE_WEBHOOK_SECRET', undefined);
		expect(getStripeWebhookSecrets()).toEqual([]);
		vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_one, whsec_two,not-a-secret');
		expect(getStripeWebhookSecrets()).toEqual(['whsec_one', 'whsec_two']);
	});
});
