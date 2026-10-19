import type { NextRequest } from 'next/server';
import { getAvailability } from '@/lib/public-booking/availability';
import { loadBookingShop } from '@/lib/public-booking/data';
import { invalidRequest, notFound } from '@/lib/public-booking/responses';
import { availabilityQuerySchema } from '@/lib/public-booking/schemas';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Instant } from '@/lib/time';

// Slots change with every booking: let the CDN absorb bursts briefly, never the browser.
const CACHE_CONTROL = 'public, max-age=0, s-maxage=10, stale-while-revalidate=20';

export async function GET(
	request: NextRequest,
	ctx: RouteContext<'/api/public/[slug]/availability'>,
) {
	const { slug } = await ctx.params;
	const parsed = availabilityQuerySchema.safeParse(
		Object.fromEntries(request.nextUrl.searchParams),
	);
	if (!parsed.success) return invalidRequest(parsed.error);

	const db = createAdminClient();
	const shop = await loadBookingShop(db, slug);
	if (!shop) return notFound();

	const result = await getAvailability(db, shop, parsed.data, Date.now() as Instant);
	if (!result.ok) {
		return notFound(
			result.error === 'service_not_found'
				? 'That service is no longer available.'
				: 'That stylist is no longer available.',
		);
	}
	return Response.json(result.value, { headers: { 'Cache-Control': CACHE_CONTROL } });
}
