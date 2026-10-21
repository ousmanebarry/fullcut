import type { Db } from '@/lib/shop/settings';
import {
	instantToIso,
	localDate,
	localDateOf,
	zonedToInstant,
	type Instant,
	type TimeZone,
} from '@/lib/time';

export interface RefillMetric {
	/** Bookings made from a waitlist offer this month that weren't cancelled. */
	slotsRecovered: number;
	/** Price of those bookings that were completed. */
	revenueCents: number;
}

/** Waitlist refills with a start time in the current shop-local calendar month. */
export async function loadRefillMetric(
	db: Db,
	shopId: string,
	zone: TimeZone,
	now: Instant,
): Promise<RefillMetric> {
	const today = localDateOf(now, zone);
	const year = Number(today.slice(0, 4));
	const month = Number(today.slice(5, 7));
	const first = localDate(`${today.slice(0, 7)}-01`);
	const next = localDate(
		month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`,
	);

	const { data, error } = await db
		.from('bookings')
		.select('status, price_cents')
		.eq('shop_id', shopId)
		.eq('source', 'waitlist')
		.neq('status', 'cancelled')
		.gte('starts_at', instantToIso(zonedToInstant(first, 0, zone)))
		.lt('starts_at', instantToIso(zonedToInstant(next, 0, zone)));
	if (error) throw error;

	return {
		slotsRecovered: data.length,
		revenueCents: data
			.filter((b) => b.status === 'completed')
			.reduce((sum, b) => sum + b.price_cents, 0),
	};
}
