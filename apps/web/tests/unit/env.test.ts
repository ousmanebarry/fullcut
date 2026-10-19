import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSiteUrl } from '@/lib/env';

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
