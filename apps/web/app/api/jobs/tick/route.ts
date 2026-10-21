import { getJobsSecret, getMessagingMode, getSiteUrl } from '@/lib/env';
import { getMessageSender } from '@/lib/messaging/sender';
import { secretsMatch, STATUS_CALLBACK_PATH, twilioWebhookUrl } from '@/lib/messaging/webhooks';
import { runMessageBatch } from '@/lib/messaging/worker';
import { runRiskBatch } from '@/lib/risk/jobs';
import { createAdminClient } from '@/lib/supabase/admin';
import { runWaitlistBatch } from '@/lib/waitlist/refill';

// Called every minute by pg_cron + pg_net (docs/adr/0008-background-jobs-and-messaging.md).
export const maxDuration = 60;

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function POST(request: Request) {
	const secret = getJobsSecret();
	const given = request.headers.get('authorization');
	if (!secret || !given || !secretsMatch(given, `Bearer ${secret}`)) {
		return Response.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });
	}

	const db = createAdminClient();
	// Deadlines first: a release frees a slot for the waitlist step right after it.
	const risk = await runRiskBatch(db, { budgetMs: 10_000 });
	// Offers first, so the texts they queue go out in this same tick.
	const waitlist = await runWaitlistBatch(db, { budgetMs: 15_000 });
	const messages = await runMessageBatch(db, {
		sender: getMessageSender(),
		siteUrl: getSiteUrl(),
		statusCallbackUrl:
			getMessagingMode() === 'twilio' ? twilioWebhookUrl(STATUS_CALLBACK_PATH) : null,
		budgetMs: 25_000,
	});
	return Response.json({ risk, waitlist, messages }, { headers: NO_STORE });
}
