'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { signInSchema, signUpSchema } from '@/lib/auth/schemas';
import { safeRedirectPath } from '@/lib/auth/redirect';
import { signInAsDemoUser } from '@/lib/demo/sign-in';
import { getDemoEnv, getSiteUrl } from '@/lib/env';
import { failure, fieldErrorsFrom, success, type FormState } from '@/lib/forms';
import { clientIp, hitRateLimit, RATE_LIMITS, rateLimitKey } from '@/lib/public-booking/rate-limit';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

export async function signIn(_prev: FormState, formData: FormData): Promise<FormState> {
	const values = { email: String(formData.get('email') ?? '') };
	const parsed = signInSchema.safeParse({
		email: formData.get('email'),
		password: formData.get('password'),
	});
	if (!parsed.success) return failure(undefined, fieldErrorsFrom(parsed.error), values);

	const supabase = await createClient();
	const { error } = await supabase.auth.signInWithPassword(parsed.data);
	if (error) {
		const message =
			error.code === 'email_not_confirmed'
				? 'Confirm your email first. Check your inbox for the link.'
				: 'Incorrect email or password.';
		return failure(message, undefined, values);
	}

	redirect(safeRedirectPath(formData.get('next')) ?? '/dashboard');
}

export async function signUp(_prev: FormState, formData: FormData): Promise<FormState> {
	const values = {
		name: String(formData.get('name') ?? ''),
		email: String(formData.get('email') ?? ''),
	};
	const parsed = signUpSchema.safeParse({
		name: formData.get('name'),
		email: formData.get('email'),
		password: formData.get('password'),
	});
	if (!parsed.success) return failure(undefined, fieldErrorsFrom(parsed.error), values);

	const { name, email, password } = parsed.data;
	const supabase = await createClient();
	const { data, error } = await supabase.auth.signUp({
		email,
		password,
		options: {
			data: { name },
			emailRedirectTo: `${getSiteUrl()}/auth/callback?next=/onboarding`,
		},
	});

	if (error) {
		if (error.code === 'user_already_exists') {
			return failure(
				'An account with this email already exists. Sign in instead.',
				undefined,
				values,
			);
		}
		if (error.code === 'weak_password') {
			return failure(undefined, { password: 'Choose a stronger password.' }, values);
		}
		return failure('Could not create your account. Try again in a moment.', undefined, values);
	}

	if (data.session) redirect('/onboarding');
	return success('Check your email for a confirmation link, then come back to sign in.', values);
}

export async function signOut(): Promise<void> {
	const supabase = await createClient();
	await supabase.auth.signOut();
	redirect('/login');
}

export async function signInAsDemo(): Promise<FormState> {
	const demo = getDemoEnv();
	if (!demo) return failure('The demo is not available right now.');

	const admin = createAdminClient();
	const ip = clientIp(await headers());
	if (ip) {
		const { allowed } = await hitRateLimit(
			admin,
			rateLimitKey('demo', ip),
			RATE_LIMITS.demoSignInPerIp,
		);
		if (!allowed) return failure('Too many demo sign-ins from this network. Try again later.');
	}

	const supabase = await createClient();
	if (!(await signInAsDemoUser(admin, supabase, demo))) {
		return failure('The demo is not available right now. Try again in a moment.');
	}
	redirect('/dashboard');
}
