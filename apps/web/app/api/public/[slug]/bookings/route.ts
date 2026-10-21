import type { NextRequest } from 'next/server';
import { getSiteUrl } from '@/lib/env';
import { createPublicBooking, parseClientPhone } from '@/lib/public-booking/booking';
import { loadBookingShop } from '@/lib/public-booking/data';
import { manageUrl } from '@/lib/public-booking/links';
import { clientIp, hitRateLimit, RATE_LIMITS, rateLimitKey } from '@/lib/public-booking/rate-limit';
import {
	failureResponse,
	invalidRequest,
	notFound,
	rateLimited,
	readJson,
} from '@/lib/public-booking/responses';
import { bookingBodySchema, sourceFromParam } from '@/lib/public-booking/schemas';
import type { BookingCreated } from '@/lib/public-booking/types';
import { scoreAfterResponse } from '@/lib/risk/jobs';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Instant } from '@/lib/time';

export async function POST(request: NextRequest, ctx: RouteContext<'/api/public/[slug]/bookings'>) {
	const { slug } = await ctx.params;
	const parsed = bookingBodySchema.safeParse(await readJson(request));
	if (!parsed.success) return invalidRequest(parsed.error);
	const { website, ...body } = parsed.data;
	if (website) return invalidRequest(undefined, 'We could not take this booking.');

	const db = createAdminClient();
	const ip = clientIp(request.headers);
	if (ip) {
		const limit = await hitRateLimit(db, rateLimitKey('booking-ip', ip), RATE_LIMITS.bookingPerIp);
		if (!limit.allowed) return rateLimited(limit.retryAfterSeconds);
	}

	const shop = await loadBookingShop(db, slug);
	if (!shop) return notFound();

	const phone = parseClientPhone(shop, body.phone);
	if (!phone.ok) return failureResponse({ kind: 'invalid', fieldErrors: phone.error });

	const phoneLimit = await hitRateLimit(
		db,
		rateLimitKey(`booking-phone:${shop.id}`, phone.value),
		RATE_LIMITS.bookingPerPhone,
	);
	if (!phoneLimit.allowed) return rateLimited(phoneLimit.retryAfterSeconds);

	const result = await createPublicBooking(
		db,
		shop,
		{
			...body,
			phoneE164: phone.value,
			source: sourceFromParam(request.nextUrl.searchParams.get('src')),
		},
		Date.now() as Instant,
	);
	if (!result.ok) return failureResponse(result.error);
	scoreAfterResponse(db, result.value.bookingId);

	const created: BookingCreated = {
		reference: result.value.reference,
		manageUrl: manageUrl(getSiteUrl(), result.value.token),
		booking: result.value.details,
	};
	return Response.json(created, { status: 201, headers: { 'Cache-Control': 'no-store' } });
}
