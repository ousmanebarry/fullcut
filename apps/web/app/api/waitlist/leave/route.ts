import { clientIp, hitRateLimit, RATE_LIMITS, rateLimitKey } from '@/lib/public-booking/rate-limit';
import { linkNotValid, rateLimited, readJson } from '@/lib/public-booking/responses';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Instant } from '@/lib/time';
import { findEntryByToken, leaveWaitlist } from '@/lib/waitlist/manage';
import { leaveBodySchema } from '@/lib/waitlist/schemas';

export async function POST(request: Request) {
	const parsed = leaveBodySchema.safeParse(await readJson(request));
	if (!parsed.success) return linkNotValid();

	const db = createAdminClient();
	const ip = clientIp(request.headers);
	if (ip) {
		const limit = await hitRateLimit(db, rateLimitKey('manage-ip', ip), RATE_LIMITS.managePerIp);
		if (!limit.allowed) return rateLimited(limit.retryAfterSeconds);
	}

	const entry = await findEntryByToken(db, parsed.data.token, Date.now() as Instant);
	if (!entry) return linkNotValid();

	// Leaving twice is harmless, so an already-closed entry still reports success.
	await leaveWaitlist(db, entry);
	return Response.json({ status: 'left' }, { headers: { 'Cache-Control': 'no-store' } });
}
