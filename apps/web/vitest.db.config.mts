import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Integration tests against the local Supabase stack (`pnpm db:start` first).
export default defineConfig({
	resolve: {
		alias: {
			'@': fileURLToPath(new URL('./', import.meta.url)),
		},
	},
	test: {
		include: ['tests/db/**/*.test.ts'],
		environment: 'node',
	},
});
