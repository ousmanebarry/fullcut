import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Integration tests against the local Supabase stack (`pnpm db:start` first).
export default defineConfig({
	resolve: {
		alias: {
			'@': fileURLToPath(new URL('./', import.meta.url)),
			'server-only': fileURLToPath(new URL('./tests/db/server-only-stub.ts', import.meta.url)),
		},
	},
	test: {
		include: ['tests/db/**/*.test.ts'],
		environment: 'node',
		// The message and waitlist workers claim due rows database-wide; parallel files would steal each other's work.
		fileParallelism: false,
	},
});
