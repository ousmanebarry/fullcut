import { z } from 'zod';
import { getTwilioAuthToken } from '@/lib/env';
import { handleInbound } from '@/lib/messaging/inbound';
import {
	forgetWebhookEvent,
	INBOUND_PATH,
	readTwilioForm,
	recordWebhookEvent,
	twilioWebhookUrl,
	twimlResponse,
	verifyTwilioSignature,
} from '@/lib/messaging/webhooks';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Instant } from '@/lib/time';

const inboundSchema = z.object({
	MessageSid: z.string().regex(/^(SM|MM)[0-9a-f]{32}$/),
	From: z.string().regex(/^\+[1-9][0-9]{6,14}$/),
	Body: z.string().max(1600).default(''),
});

export async function POST(request: Request) {
	const authToken = getTwilioAuthToken();
	const params = await readTwilioForm(request);
	if (
		!authToken ||
		!params ||
		!verifyTwilioSignature(
			authToken,
			request.headers.get('x-twilio-signature'),
			twilioWebhookUrl(INBOUND_PATH),
			params,
		)
	) {
		return new Response(null, { status: 403, headers: { 'Cache-Control': 'no-store' } });
	}

	const parsed = inboundSchema.safeParse(params);
	// Signed but not an SMS we can act on (e.g. a short code sender): acknowledge and drop.
	if (!parsed.success) return twimlResponse();
	const { MessageSid: sid, From: from, Body: body } = parsed.data;

	const db = createAdminClient();
	if (!(await recordWebhookEvent(db, sid))) return twimlResponse();
	try {
		await handleInbound(db, { sid, from, body }, Date.now() as Instant);
	} catch (error) {
		await forgetWebhookEvent(db, sid);
		throw error;
	}
	// No auto-reply: Twilio's Advanced Opt-Out already answers STOP/START.
	return twimlResponse();
}
