'use server';

import { refresh } from 'next/cache';
import { requireShopMember, toActor } from '@/lib/auth/session';
import { idSchema } from '@/lib/dashboard/schemas';
import { setReplyHandled } from '@/lib/messaging/mutations';
import { createClient } from '@/lib/supabase/server';
import type { Instant } from '@/lib/time';

export async function markReplyHandledAction(formData: FormData): Promise<void> {
	const id = idSchema.safeParse(formData.get('id'));
	if (!id.success) return;
	const ctx = await requireShopMember();
	await setReplyHandled(await createClient(), toActor(ctx), id.data, true, Date.now() as Instant);
	refresh();
}
