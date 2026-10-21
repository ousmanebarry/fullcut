import type { Db } from '@/lib/shop/settings';
import { instantToIso, type Instant } from '@/lib/time';
import type { TierShares } from './types';

const SHARE_WINDOW_DAYS = 90;

/** Share of the shop's recently scored bookings in each tier; empty when nothing was scored yet. */
export async function loadTierShares(db: Db, shopId: string, now: Instant): Promise<TierShares> {
	const since = instantToIso((now - SHARE_WINDOW_DAYS * 86_400_000) as Instant);
	const count = async (tiers: string[]) => {
		const { count: n, error } = await db
			.from('bookings')
			.select('id', { count: 'exact', head: true })
			.eq('shop_id', shopId)
			.in('risk_tier', tiers)
			.gte('starts_at', since);
		if (error) throw error;
		return n ?? 0;
	};
	const [total, medium, high] = await Promise.all([
		count(['low', 'medium', 'high']),
		count(['medium']),
		count(['high']),
	]);
	return total === 0 ? {} : { medium: medium / total, high: high / total };
}
