import { revalidateTag } from 'next/cache';
import { getStripeWebhookSecrets } from '@/lib/env';
import { forgetWebhookEvent, recordWebhookEvent } from '@/lib/messaging/webhooks';
import { handleStripeEvent, parseStripeEvent, verifyStripeSignature } from '@/lib/payments/events';
import { getPaymentGateway } from '@/lib/payments/gateway';
import { publicShopTag } from '@/lib/public-booking/cached';
import { createAdminClient } from '@/lib/supabase/admin';

// Stripe snapshot events (Checkout, refunds) and thin v2 account events (docs/adr/0009-payments-charge-model.md).
const NO_STORE = { 'Cache-Control': 'no-store' };

export async function POST(request: Request) {
	const payload = await request.text();
	const signature = request.headers.get('stripe-signature');
	const secrets = getStripeWebhookSecrets();
	if (!signature || secrets.length === 0 || !verifyStripeSignature(payload, signature, secrets)) {
		return Response.json({ error: 'invalid_signature' }, { status: 400, headers: NO_STORE });
	}

	const event = parseStripeEvent(payload);
	if (!event) return Response.json({ error: 'invalid_event' }, { status: 400, headers: NO_STORE });

	const db = createAdminClient();
	if (!(await recordWebhookEvent(db, event.id, 'stripe'))) {
		return Response.json({ received: true }, { headers: NO_STORE });
	}
	try {
		const changedShopId = await handleStripeEvent(db, getPaymentGateway(), event);
		if (changedShopId) revalidateTag(publicShopTag.id(changedShopId), { expire: 0 });
	} catch (error) {
		await forgetWebhookEvent(db, event.id, 'stripe');
		throw error;
	}
	return Response.json({ received: true }, { headers: NO_STORE });
}
