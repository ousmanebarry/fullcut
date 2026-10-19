import 'server-only';
import { refresh } from 'next/cache';
import { requireShopMember, toActor } from '@/lib/auth/session';
import { failure, success, type FormState } from '@/lib/forms';
import type { MutationResult } from '@/lib/shop/settings';
import { createClient } from '@/lib/supabase/server';

// Every settings action starts here: membership is checked server-side and the shop comes from the session.
export async function settingsActionContext() {
	const ctx = await requireShopMember();
	return { ctx, actor: toActor(ctx), db: await createClient() };
}

export function toFormState(
	result: MutationResult,
	message: string,
	values?: Record<string, string>,
): FormState {
	if (result.ok) {
		refresh();
		return success(message);
	}
	const { field, message: error } = result.error;
	return failure(error, field ? { [field]: error } : undefined, values);
}
