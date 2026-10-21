import type { NextRequest } from 'next/server';
import { loadBookingShop } from '@/lib/public-booking/data';
import { parseClientPhone } from '@/lib/public-booking/booking';
import { clientIp, hitRateLimit, RATE_LIMITS, rateLimitKey } from '@/lib/public-booking/rate-limit';
import { invalidRequest, notFound, rateLimited, readJson } from '@/lib/public-booking/responses';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Instant } from '@/lib/time';
import { joinWaitlist } from '@/lib/waitlist/join';
import { waitlistFailureResponse } from '@/lib/waitlist/responses';
import { waitlistBodySchema } from '@/lib/waitlist/schemas';

export async function POST(request: NextRequest, ctx: RouteContext<'/api/public/[slug]/waitlist'>) {
	const { slug } = await ctx.params;
	const parsed = waitlistBodySchema.safeParse(await readJson(request));
	if (!parsed.success) return invalidRequest(parsed.error);
	const body = parsed.data;
	if (body.website) return invalidRequest(undefined, 'We could not add you to the waitlist.');

	const db = createAdminClient();
	const ip = clientIp(request.headers);
	if (ip) {
		const limit = await hitRateLimit(
			db,
			rateLimitKey('waitlist-ip', ip),
			RATE_LIMITS.waitlistPerIp,
		);
		if (!limit.allowed) return rateLimited(limit.retryAfterSeconds);
	}

	const shop = await loadBookingShop(db, slug);
	if (!shop) return notFound();

	const phone = parseClientPhone(shop, body.phone);
	if (!phone.ok) return waitlistFailureResponse({ kind: 'invalid', fieldErrors: phone.error });

	const phoneLimit = await hitRateLimit(
		db,
		rateLimitKey(`waitlist-phone:${shop.id}`, phone.value),
		RATE_LIMITS.waitlistPerPhone,
	);
	if (!phoneLimit.allowed) return rateLimited(phoneLimit.retryAfterSeconds);

	const result = await joinWaitlist(
		db,
		shop,
		{ ...body, phoneE164: phone.value },
		Date.now() as Instant,
	);
	if (!result.ok) return waitlistFailureResponse(result.error);

	return Response.json(
		{ status: 'joined' },
		{ status: 201, headers: { 'Cache-Control': 'no-store' } },
	);
}
