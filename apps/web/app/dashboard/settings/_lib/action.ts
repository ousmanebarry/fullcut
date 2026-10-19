import 'server-only';
import { refresh, updateTag } from 'next/cache';
import { getCurrentShop, requireShopMember, toActor } from '@/lib/auth/session';
import { failure, success, type FormState } from '@/lib/forms';
import { publicShopTag } from '@/lib/public-booking/cached';
import type { MutationResult } from '@/lib/shop/settings';
import { createClient } from '@/lib/supabase/server';

// Every settings action starts here: membership is checked server-side and the shop comes from the session.
export async function settingsActionContext() {
	const ctx = await requireShopMember();
	return { ctx, actor: toActor(ctx), db: await createClient() };
}

export async function toFormState(
	result: MutationResult,
	message: string,
	values?: Record<string, string>,
): Promise<FormState> {
	if (result.ok) {
		await expirePublicShop();
		refresh();
		return success(message);
	}
	const { field, message: error } = result.error;
	return failure(error, field ? { [field]: error } : undefined, values);
}

/** Settings feed the public booking page; drop its cached copy (by id and by slug). */
export async function expirePublicShop(...extraSlugs: string[]): Promise<void> {
	const ctx = await getCurrentShop();
	if (!ctx) return;
	updateTag(publicShopTag.id(ctx.shop.id));
	for (const slug of [ctx.shop.slug, ...extraSlugs]) updateTag(publicShopTag.slug(slug));
}
