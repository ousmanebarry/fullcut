import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));

export const dbUrl =
	process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:55322/postgres';

/** API URL and publishable key for the local stack, from env or `supabase status`. */
export function localSupabaseApi(): { url: string; publishableKey: string } {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
	if (url && publishableKey) return { url, publishableKey };
	const status = supabaseStatus();
	return { url: status.url, publishableKey: status.publishableKey };
}

/** Points the app's env (lib/env.ts) at the local stack so server code can run in tests. */
export function useLocalSupabaseEnv(): void {
	if (
		process.env.NEXT_PUBLIC_SUPABASE_URL &&
		process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY &&
		process.env.SUPABASE_SECRET_KEY
	) {
		return;
	}
	const status = supabaseStatus();
	process.env.NEXT_PUBLIC_SUPABASE_URL = status.url;
	process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = status.publishableKey;
	process.env.SUPABASE_SECRET_KEY = status.secretKey;
}

function supabaseStatus(): { url: string; publishableKey: string; secretKey: string } {
	const output = execSync('pnpm exec supabase status -o env', {
		cwd: repoRoot,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'ignore'],
	});
	const vars = new Map<string, string>();
	for (const line of output.split(/\r?\n/)) {
		const match = /^([A-Z_]+)="?(.*?)"?$/.exec(line);
		if (match?.[1] && match[2] !== undefined) vars.set(match[1], match[2]);
	}
	const apiUrl = vars.get('API_URL');
	const key = vars.get('PUBLISHABLE_KEY');
	const secretKey = vars.get('SECRET_KEY');
	if (!apiUrl || !key || !secretKey) {
		throw new Error('Local Supabase is not running (`pnpm db:start`).');
	}
	return { url: apiUrl, publishableKey: key, secretKey };
}
