import 'server-only';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { getServerEnv } from '@/lib/env';

// Bypasses RLS. Only call from server code with a shop_id or user id derived on the server.
export function createAdminClient() {
	const env = getServerEnv();
	return createClient<Database>(env.supabaseUrl, env.supabaseSecretKey, {
		auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
	});
}
