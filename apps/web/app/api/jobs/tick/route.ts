import { getJobsSecret, getMessagingMode, getSiteUrl } from '@/lib/env';
import { getMessageSender } from '@/lib/messaging/sender';
import { secretsMatch, STATUS_CALLBACK_PATH, twilioWebhookUrl } from '@/lib/messaging/webhooks';
import { runMessageBatch } from '@/lib/messaging/worker';
import { getPaymentGateway } from '@/lib/payments/gateway';
import { runPaymentJobs } from '@/lib/payments/jobs';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Instant } from '@/lib/time';

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
	const payments = await runPaymentJobs(db, getPaymentGateway(), Date.now() as Instant);
	const messages = await runMessageBatch(db, {
		sender: getMessageSender(),
		siteUrl: getSiteUrl(),
		statusCallbackUrl:
			getMessagingMode() === 'twilio' ? twilioWebhookUrl(STATUS_CALLBACK_PATH) : null,
		budgetMs: 40_000,
	});
	return Response.json({ payments, messages }, { headers: NO_STORE });
}
