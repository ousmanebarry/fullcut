import { findBookingByToken, rescheduleManagedBooking } from '@/lib/public-booking/manage';
import { clientIp, hitRateLimit, RATE_LIMITS, rateLimitKey } from '@/lib/public-booking/rate-limit';
import {
	failureResponse,
	invalidRequest,
	linkNotValid,
	rateLimited,
	readJson,
} from '@/lib/public-booking/responses';
import { cancelBodySchema, rescheduleBodySchema } from '@/lib/public-booking/schemas';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Instant } from '@/lib/time';

export async function POST(request: Request) {
	const body = await readJson(request);
	if (!cancelBodySchema.safeParse(body).success) return linkNotValid();
	const parsed = rescheduleBodySchema.safeParse(body);
	if (!parsed.success) return invalidRequest(parsed.error);

	const db = createAdminClient();
	const ip = clientIp(request.headers);
	if (ip) {
		const limit = await hitRateLimit(db, rateLimitKey('manage-ip', ip), RATE_LIMITS.managePerIp);
		if (!limit.allowed) return rateLimited(limit.retryAfterSeconds);
	}

	const now = Date.now() as Instant;
	const booking = await findBookingByToken(db, parsed.data.token, now);
	if (!booking) return linkNotValid();

	const result = await rescheduleManagedBooking(
		db,
		booking,
		{ staffId: parsed.data.staffId, startsAt: parsed.data.startsAt },
		now,
	);
	if (!result.ok) return failureResponse(result.error);
	return Response.json({ booking: result.value }, { headers: { 'Cache-Control': 'no-store' } });
}
