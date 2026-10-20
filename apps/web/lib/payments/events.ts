import 'server-only';
import Stripe from 'stripe';
import { z } from 'zod';
import type { Db } from '@/lib/shop/settings';
import type { PaymentGateway } from './gateway';
import { recordRefunded, sendDueRefunds } from './refunds';

/** A verified Stripe event: a snapshot event (v1 objects) or a thin event notification (v2). */
export type StripeEvent =
	| { kind: 'snapshot'; id: string; type: string; account: string | null; object: unknown }
	| { kind: 'thin'; id: string; type: string; relatedObject: { id: string; type: string } | null };

const snapshotSchema = z.object({
	id: z.string().min(1),
	object: z.literal('event'),
	type: z.string(),
	account: z.string().nullish(),
	data: z.object({ object: z.unknown() }),
});

const thinSchema = z.object({
	id: z.string().min(1),
	object: z.literal('v2.core.event'),
	type: z.string(),
	related_object: z.object({ id: z.string(), type: z.string() }).nullish(),
});

/** True when the header was signed with any of the secrets (each Stripe destination has its own). */
export function verifyStripeSignature(
	payload: string,
	header: string,
	secrets: readonly string[],
): boolean {
	return secrets.some((secret) => {
		try {
			return Stripe.webhooks.signature?.verifyHeader(payload, header, secret) === true;
		} catch {
			return false;
		}
	});
}

export function parseStripeEvent(payload: string): StripeEvent | null {
	let json: unknown;
	try {
		json = JSON.parse(payload);
	} catch {
		return null;
	}
	const thin = thinSchema.safeParse(json);
	if (thin.success) {
		return {
			kind: 'thin',
			id: thin.data.id,
			type: thin.data.type,
			relatedObject: thin.data.related_object ?? null,
		};
	}
	const snapshot = snapshotSchema.safeParse(json);
	if (!snapshot.success) return null;
	return {
		kind: 'snapshot',
		id: snapshot.data.id,
		type: snapshot.data.type,
		account: snapshot.data.account ?? null,
		object: snapshot.data.data.object,
	};
}

const sessionSchema = z.object({
	id: z.string(),
	payment_status: z.string(),
	payment_intent: z.string().nullable(),
	metadata: z.object({ booking_id: z.uuid(), shop_id: z.uuid() }),
});

const chargeSchema = z.object({
	payment_intent: z.string(),
	amount_refunded: z.number().int().nonnegative(),
});

const refundSchema = z.object({
	payment_intent: z.string(),
	status: z.string().nullable(),
	failure_reason: z.string().nullish(),
});

const accountSchema = z.object({ id: z.string().startsWith('acct_') });

/**
 * Applies one Stripe event. Every change is conditional on current state, so replays are harmless.
 * Returns the id of a shop whose ability to take deposits may have changed, if any.
 */
export async function handleStripeEvent(
	db: Db,
	gateway: PaymentGateway | null,
	event: StripeEvent,
): Promise<string | null> {
	if (event.kind === 'thin') {
		if (
			event.type.startsWith('v2.core.account') &&
			event.relatedObject?.type === 'v2.core.account'
		) {
			return refreshAccountStatus(db, gateway, event.relatedObject.id);
		}
		return null;
	}

	switch (event.type) {
		case 'checkout.session.completed': {
			const session = sessionSchema.safeParse(event.object);
			// Not one of ours (no booking metadata), or a delayed method that hasn't paid yet.
			if (!session.success || session.data.payment_status !== 'paid') return null;
			const { id, payment_intent, metadata } = session.data;
			const { data: outcome, error } = await db.rpc('confirm_deposit_payment', {
				p_shop_id: metadata.shop_id,
				p_booking_id: metadata.booking_id,
				p_session_id: id,
				p_payment_intent_id: payment_intent ?? '',
			});
			if (error) throw error;
			if (outcome === 'refund_due' && gateway) {
				await sendDueRefunds(db, gateway, {
					shopId: metadata.shop_id,
					bookingId: metadata.booking_id,
				});
			}
			return null;
		}
		case 'checkout.session.expired': {
			const session = sessionSchema.safeParse(event.object);
			if (!session.success) return null;
			const { error } = await db.rpc('expire_deposit_checkout', {
				p_shop_id: session.data.metadata.shop_id,
				p_booking_id: session.data.metadata.booking_id,
				p_session_id: session.data.id,
			});
			if (error) throw error;
			return null;
		}
		case 'charge.refunded': {
			const charge = chargeSchema.safeParse(event.object);
			if (!charge.success || !event.account) return null;
			await syncRefunded(
				db,
				event.account,
				charge.data.payment_intent,
				charge.data.amount_refunded,
			);
			return null;
		}
		case 'refund.failed':
		case 'refund.updated': {
			const refund = refundSchema.safeParse(event.object);
			if (!refund.success || !event.account || refund.data.status !== 'failed' || !gateway) {
				return null;
			}
			const total = await gateway.refundedCents(event.account, refund.data.payment_intent);
			await syncRefunded(db, event.account, refund.data.payment_intent, total);
			const { error } = await db
				.from('payments')
				.update({ refund_error: `Refund failed (${refund.data.failure_reason ?? 'unknown'})` })
				.eq('stripe_account_id', event.account)
				.eq('stripe_payment_intent_id', refund.data.payment_intent);
			if (error) throw error;
			return null;
		}
		case 'account.updated': {
			const account = accountSchema.safeParse(event.object);
			const id = event.account ?? (account.success ? account.data.id : null);
			return id ? refreshAccountStatus(db, gateway, id) : null;
		}
		default:
			return null;
	}
}

async function syncRefunded(
	db: Db,
	accountId: string,
	paymentIntentId: string,
	totalRefundedCents: number,
): Promise<void> {
	const { data: payment, error } = await db
		.from('payments')
		.select('id, amount_cents, refund_due_cents')
		.eq('stripe_account_id', accountId)
		.eq('stripe_payment_intent_id', paymentIntentId)
		.maybeSingle();
	if (error) throw error;
	if (payment) await recordRefunded(db, payment, totalRefundedCents);
}

/** Copies the connected account's readiness onto its shop; returns that shop's id. */
export async function refreshAccountStatus(
	db: Db,
	gateway: PaymentGateway | null,
	accountId: string,
): Promise<string | null> {
	if (!gateway) return null;
	const status = await gateway.accountStatus(accountId);
	const { data, error } = await db
		.from('shops')
		.update({
			stripe_charges_enabled: status.chargesEnabled,
			stripe_details_submitted: status.detailsSubmitted,
		})
		.eq('stripe_account_id', accountId)
		.select('id');
	if (error) throw error;
	return data[0]?.id ?? null;
}
