import { NextResponse, type NextRequest } from 'next/server';
import { updateSession, withSession } from '@/lib/supabase/proxy';

const SIGNED_IN_ONLY = ['/dashboard', '/onboarding'];
const SIGNED_OUT_ONLY = ['/login', '/signup'];

function isUnder(pathname: string, prefixes: readonly string[]): boolean {
	return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export async function proxy(request: NextRequest) {
	const { response, userId } = await updateSession(request);
	const { pathname, search } = request.nextUrl;

	if (!userId && isUnder(pathname, SIGNED_IN_ONLY)) {
		const url = request.nextUrl.clone();
		url.pathname = '/login';
		url.search = '';
		url.searchParams.set('next', `${pathname}${search}`);
		return withSession(NextResponse.redirect(url), response);
	}

	if (userId && isUnder(pathname, SIGNED_OUT_ONLY)) {
		const url = request.nextUrl.clone();
		url.pathname = '/dashboard';
		url.search = '';
		return withSession(NextResponse.redirect(url), response);
	}

	return response;
}

export const config = {
	matcher: ['/dashboard/:path*', '/onboarding/:path*', '/login', '/signup', '/auth/:path*'],
};
