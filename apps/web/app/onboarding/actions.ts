'use server';

import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { toUserFacingError } from '@/lib/db/errors';
import { failure, fieldErrorsFrom, type FormState } from '@/lib/forms';
import { onboardingSchema, toOnboardPayload } from '@/lib/shop/schemas';
import { createAdminClient } from '@/lib/supabase/admin';

export async function completeOnboarding(_prev: FormState, formData: FormData): Promise<FormState> {
	const user = await requireUser();

	let raw: unknown;
	try {
		raw = JSON.parse(String(formData.get('payload') ?? ''));
	} catch {
		return failure('Something went wrong. Try again.');
	}

	const parsed = onboardingSchema.safeParse(raw);
	if (!parsed.success)
		return failure('Check the highlighted fields.', fieldErrorsFrom(parsed.error));

	// Service role: the user is not a member yet, so RLS would block these inserts. The user id comes from the verified JWT.
	const { error } = await createAdminClient().rpc('onboard_shop', {
		p_user_id: user.id,
		p_payload: toOnboardPayload(parsed.data),
	});

	if (error) {
		if (error.message === 'onboarding_already_member') redirect('/dashboard');
		const mapped = toUserFacingError(error);
		return failure(
			mapped.message,
			mapped.field === 'slug' ? { 'shop.slug': mapped.message } : undefined,
		);
	}

	redirect('/dashboard');
}
