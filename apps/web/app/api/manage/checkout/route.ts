import { resumeDepositCheckout } from '@/lib/payments/checkout';
import { getPaymentGateway } from '@/lib/payments/gateway';
import { findBookingByToken } from '@/lib/public-booking/manage';
import { clientIp, hitRateLimit, RATE_LIMITS, rateLimitKey } from '@/lib/public-booking/rate-limit';
import { apiError, linkNotValid, rateLimited, readJson } from '@/lib/public-booking/responses';
import { cancelBodySchema } from '@/lib/public-booking/schemas';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Instant } from '@/lib/time';

// Resume paying the deposit for a held booking (the client left Stripe or closed the tab).
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

	const gateway = getPaymentGateway();
	const url = gateway
		? await resumeDepositCheckout(db, gateway, booking.shop.id, booking.bookingId, now)
		: null;
	if (!url) {
		return apiError(
			{
				error: 'not_active',
				message: 'This booking can no longer be paid for. Please book again.',
			},
			409,
		);
	}
	return Response.json({ checkoutUrl: url }, { headers: { 'Cache-Control': 'no-store' } });
}
