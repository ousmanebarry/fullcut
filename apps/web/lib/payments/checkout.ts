import type { Db } from '@/lib/shop/settings';
import { instantFromIso, type Instant } from '@/lib/time';
import type { PaymentGateway } from './gateway';

export interface DepositCheckout {
	shopId: string;
	bookingId: string;
	amountCents: number;
	platformFeeCents: number;
	currency: string;
	description: string;
	expiresAt: Instant;
	/** The client's manage page; Stripe returns them there. */
	manageUrl: string;
	email: string | null;
}

/**
 * Opens a Stripe Checkout Session for a held booking and returns its URL. If Stripe can't be reached
 * the hold is released straight away, so the slot isn't blocked for nothing.
 */
export async function startDepositCheckout(
	db: Db,
	gateway: PaymentGateway,
	input: DepositCheckout,
): Promise<string> {
	const { data: payment, error } = await db
		.from('payments')
		.select('stripe_account_id')
		.eq('shop_id', input.shopId)
		.eq('booking_id', input.bookingId)
		.single();
	if (error) throw error;

	try {
		const session = await gateway.createCheckout({
			accountId: payment.stripe_account_id,
			shopId: input.shopId,
			bookingId: input.bookingId,
			amountCents: input.amountCents,
			platformFeeCents: input.platformFeeCents,
			currency: input.currency,
			description: input.description,
			expiresAt: input.expiresAt,
			successUrl: `${input.manageUrl}?checkout=success`,
			cancelUrl: `${input.manageUrl}?checkout=cancelled`,
			customerEmail: input.email,
		});
		// If this write fails, the webhook records the session id from the signed event instead.
		await db
			.from('payments')
			.update({ stripe_checkout_session_id: session.sessionId })
			.eq('shop_id', input.shopId)
			.eq('booking_id', input.bookingId);
		return session.url;
	} catch (cause) {
		await releaseHold(db, input.shopId, input.bookingId);
		throw cause;
	}
}

async function releaseHold(db: Db, shopId: string, bookingId: string): Promise<void> {
	await db
		.from('bookings')
		.update({ status: 'cancelled', cancelled_by: 'system' })
		.eq('shop_id', shopId)
		.eq('id', bookingId)
		.eq('status', 'pending');
	await db
		.from('payments')
		.update({ status: 'expired' })
		.eq('shop_id', shopId)
		.eq('booking_id', bookingId)
		.eq('status', 'pending');
}

/** Closes the Stripe session of a hold the client cancelled, so it can no longer be paid. */
export async function closeDepositCheckout(
	db: Db,
	gateway: PaymentGateway,
	shopId: string,
	bookingId: string,
): Promise<void> {
	const { data: payment, error } = await db
		.from('payments')
		.select('stripe_account_id, stripe_checkout_session_id, status')
		.eq('shop_id', shopId)
		.eq('booking_id', bookingId)
		.maybeSingle();
	if (error) throw error;
	if (payment?.status !== 'pending' || !payment.stripe_checkout_session_id) return;
	await gateway.expireCheckout(payment.stripe_account_id, payment.stripe_checkout_session_id);
}

/** The Stripe page to resume paying for a held booking, or null if it can no longer be paid. */
export async function resumeDepositCheckout(
	db: Db,
	gateway: PaymentGateway,
	shopId: string,
	bookingId: string,
	now: Instant,
): Promise<string | null> {
	const { data, error } = await db
		.from('payments')
		.select(
			'stripe_account_id, stripe_checkout_session_id, status, booking:bookings!payments_booking_same_shop_fk!inner(status, pending_expires_at)',
		)
		.eq('shop_id', shopId)
		.eq('booking_id', bookingId)
		.maybeSingle();
	if (error) throw error;
	if (
		!data ||
		data.status !== 'pending' ||
		!data.stripe_checkout_session_id ||
		data.booking.status !== 'pending' ||
		!data.booking.pending_expires_at ||
		instantFromIso(data.booking.pending_expires_at) <= now
	) {
		return null;
	}
	return gateway.openCheckoutUrl(data.stripe_account_id, data.stripe_checkout_session_id);
}
