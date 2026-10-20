import { z } from 'zod';
import { getTwilioAuthToken } from '@/lib/env';
import { applyStatusCallback, isDeliveryStatus } from '@/lib/messaging/status';
import {
	forgetWebhookEvent,
	readTwilioForm,
	recordWebhookEvent,
	STATUS_CALLBACK_PATH,
	twilioWebhookUrl,
	verifyTwilioSignature,
} from '@/lib/messaging/webhooks';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Instant } from '@/lib/time';

const statusSchema = z.object({
	MessageSid: z.string().regex(/^(SM|MM)[0-9a-f]{32}$/),
	MessageStatus: z.string().refine(isDeliveryStatus),
	ErrorCode: z.coerce.number().int().optional(),
});

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function POST(request: Request) {
	const authToken = getTwilioAuthToken();
	const params = await readTwilioForm(request);
	if (
		!authToken ||
		!params ||
		!verifyTwilioSignature(
			authToken,
			request.headers.get('x-twilio-signature'),
			twilioWebhookUrl(STATUS_CALLBACK_PATH),
			params,
		)
	) {
		return new Response(null, { status: 403, headers: NO_STORE });
	}

	const parsed = statusSchema.safeParse(params);
	// Statuses we don't track (e.g. "scheduled") are acknowledged and ignored.
	if (!parsed.success) return new Response(null, { status: 204, headers: NO_STORE });
	const { MessageSid: sid, MessageStatus: status, ErrorCode: errorCode } = parsed.data;

	const db = createAdminClient();
	const eventId = `${sid}:${status}`;
	if (!(await recordWebhookEvent(db, eventId))) {
		return new Response(null, { status: 204, headers: NO_STORE });
	}
	try {
		await applyStatusCallback(
			db,
			{ sid, status, errorCode: errorCode ?? null },
			Date.now() as Instant,
		);
	} catch (error) {
		await forgetWebhookEvent(db, eventId);
		throw error;
	}
	return new Response(null, { status: 204, headers: NO_STORE });
}
