import type { EmailOtpType } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { safeRedirectPath } from '@/lib/auth/redirect';
import { createClient } from '@/lib/supabase/server';

const EMAIL_OTP_TYPES: readonly EmailOtpType[] = [
	'signup',
	'invite',
	'magiclink',
	'recovery',
	'email_change',
	'email',
];

function isEmailOtpType(value: string | null): value is EmailOtpType {
	return EMAIL_OTP_TYPES.some((type) => type === value);
}

// Handles both PKCE (?code=) and token-hash (?token_hash=&type=) email links.
export async function GET(request: NextRequest) {
	const params = request.nextUrl.searchParams;
	const next = safeRedirectPath(params.get('next')) ?? '/dashboard';
	const code = params.get('code');
	const tokenHash = params.get('token_hash');
	const type = params.get('type');

	const supabase = await createClient();
	let ok = false;
	if (code) {
		ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
	} else if (tokenHash && isEmailOtpType(type)) {
		ok = !(await supabase.auth.verifyOtp({ type, token_hash: tokenHash })).error;
	}

	return NextResponse.redirect(new URL(ok ? next : '/login?error=link', request.url));
}
