import { defineConfig } from 'vitest/config';

// Integration tests against the local Supabase Postgres (`pnpm db:start` first).
export default defineConfig({
	test: {
		include: ['tests/db/**/*.test.ts'],
		environment: 'node',
	},
});
