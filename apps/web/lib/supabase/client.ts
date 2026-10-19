import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/lib/database.types';
import { getPublicEnv } from '@/lib/env';

export function createClient() {
	const env = getPublicEnv();
	return createBrowserClient<Database>(env.supabaseUrl, env.supabasePublishableKey);
}
