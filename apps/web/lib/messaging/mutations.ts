import type { Result } from '@/lib/booking/types';
import type { Actor, Db } from '@/lib/shop/settings';
import { instantToIso, type Instant } from '@/lib/time';

/** Marks an inbox reply handled (or reopens it); any member may. handled_by is stamped by the database. */
export async function setReplyHandled(
	db: Db,
	actor: Actor,
	replyId: string,
	handled: boolean,
	now: Instant,
): Promise<Result<null, { message: string }>> {
	const { data, error } = await db
		.from('inbound_messages')
		.update({ handled_at: handled ? instantToIso(now) : null })
		.eq('shop_id', actor.shopId)
		.eq('id', replyId)
		.select('id');
	if (error) throw error;
	return data.length === 1
		? { ok: true, value: null }
		: { ok: false, error: { message: 'That message no longer exists.' } };
}
