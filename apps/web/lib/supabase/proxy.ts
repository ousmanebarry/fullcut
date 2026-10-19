import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { Database } from '@/lib/database.types';
import { getPublicEnv } from '@/lib/env';

const CACHE_HEADERS = ['cache-control', 'expires', 'pragma'] as const;

export async function updateSession(
	request: NextRequest,
): Promise<{ response: NextResponse; userId: string | null }> {
	const env = getPublicEnv();
	let response = NextResponse.next({ request });

	const supabase = createServerClient<Database>(env.supabaseUrl, env.supabasePublishableKey, {
		cookies: {
			getAll() {
				return request.cookies.getAll();
			},
			setAll(cookiesToSet, headers) {
				for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
				response = NextResponse.next({ request });
				for (const { name, value, options } of cookiesToSet) {
					response.cookies.set(name, value, options);
				}
				for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
			},
		},
	});

	// Verifies the JWT and refreshes it when close to expiry; never trust getSession() here.
	const { data } = await supabase.auth.getClaims();
	return { response, userId: data?.claims.sub ?? null };
}

// A redirect must carry the refreshed cookies, or the user is signed out on the next request.
export function withSession(target: NextResponse, source: NextResponse): NextResponse {
	for (const cookie of source.cookies.getAll()) target.cookies.set(cookie);
	for (const header of CACHE_HEADERS) {
		const value = source.headers.get(header);
		if (value) target.headers.set(header, value);
	}
	return target;
}
