import { getSiteUrl } from '@/lib/env';
import { clientIp, hitRateLimit, RATE_LIMITS, rateLimitKey } from '@/lib/public-booking/rate-limit';
import { linkNotValid, rateLimited, readJson } from '@/lib/public-booking/responses';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Instant } from '@/lib/time';
import { claimOffer } from '@/lib/waitlist/claim';
import { claimFailureResponse } from '@/lib/waitlist/responses';
import { leaveBodySchema } from '@/lib/waitlist/schemas';

// POST only: link previews fetch the page with GET, and must never book on the client's behalf.
export async function POST(request: Request) {
	const parsed = leaveBodySchema.safeParse(await readJson(request));
	if (!parsed.success) return linkNotValid();

	const db = createAdminClient();
	const ip = clientIp(request.headers);
	if (ip) {
		const limit = await hitRateLimit(db, rateLimitKey('manage-ip', ip), RATE_LIMITS.managePerIp);
		if (!limit.allowed) return rateLimited(limit.retryAfterSeconds);
	}

	const result = await claimOffer(db, parsed.data.token, getSiteUrl(), Date.now() as Instant);
	if (!result.ok) return claimFailureResponse(result.error);
	return Response.json(result.value, { status: 201, headers: { 'Cache-Control': 'no-store' } });
}
