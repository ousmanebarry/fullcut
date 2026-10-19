import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { connection } from 'next/server';
import type { Database } from '@/lib/database.types';
import { getPublicEnv } from '@/lib/env';

export async function createClient() {
	// The auth client reads the clock (token expiry), which Cache Components only allows at request time.
	await connection();
	const cookieStore = await cookies();
	const env = getPublicEnv();

	return createServerClient<Database>(env.supabaseUrl, env.supabasePublishableKey, {
		cookies: {
			getAll() {
				return cookieStore.getAll();
			},
			setAll(cookiesToSet) {
				try {
					for (const { name, value, options } of cookiesToSet) {
						cookieStore.set(name, value, options);
					}
				} catch {
					// Server Components cannot set cookies; the proxy refreshes the session instead.
				}
			},
		},
	});
}

export type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>;
