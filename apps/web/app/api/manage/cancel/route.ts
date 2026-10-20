import { settleCancelledBooking } from '@/lib/payments/cancellation';
import { getPaymentGateway } from '@/lib/payments/gateway';
import { cancelManagedBooking, findBookingByToken } from '@/lib/public-booking/manage';
import { clientIp, hitRateLimit, RATE_LIMITS, rateLimitKey } from '@/lib/public-booking/rate-limit';
import {
	failureResponse,
	linkNotValid,
	rateLimited,
	readJson,
} from '@/lib/public-booking/responses';
import { cancelBodySchema } from '@/lib/public-booking/schemas';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Instant } from '@/lib/time';

export async function POST(request: Request) {
	const parsed = cancelBodySchema.safeParse(await readJson(request));
	if (!parsed.success) return linkNotValid();

	const db = createAdminClient();
	const ip = clientIp(request.headers);
	if (ip) {
		const limit = await hitRateLimit(db, rateLimitKey('manage-ip', ip), RATE_LIMITS.managePerIp);
		if (!limit.allowed) return rateLimited(limit.retryAfterSeconds);
	}

	const now = Date.now() as Instant;
	const booking = await findBookingByToken(db, parsed.data.token, now);
	if (!booking) return linkNotValid();

	const result = await cancelManagedBooking(db, booking, now);
	if (!result.ok) return failureResponse(result.error);
	await settleCancelledBooking(
		db,
		getPaymentGateway(),
		{ shopId: booking.shop.id, bookingId: booking.bookingId },
		now,
	);
	return Response.json({ status: 'cancelled' }, { headers: { 'Cache-Control': 'no-store' } });
}
