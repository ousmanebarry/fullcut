import 'server-only';
import Stripe from 'stripe';
import { getStripeSecretKey } from '@/lib/env';
import type { Instant } from '@/lib/time';

export interface CheckoutInput {
	accountId: string;
	shopId: string;
	bookingId: string;
	amountCents: number;
	platformFeeCents: number;
	currency: string;
	/** Shown on the Stripe page and the receipt. */
	description: string;
	expiresAt: Instant;
	successUrl: string;
	cancelUrl: string;
	customerEmail: string | null;
}

export interface AccountStatus {
	chargesEnabled: boolean;
	detailsSubmitted: boolean;
}

/** The Stripe calls Fullcut makes; an interface so tests can run without the network. */
export interface PaymentGateway {
	createCheckout(input: CheckoutInput): Promise<{ sessionId: string; url: string }>;
	/** The session's payment URL while it is still open, else null. */
	openCheckoutUrl(accountId: string, sessionId: string): Promise<string | null>;
	expireCheckout(accountId: string, sessionId: string): Promise<void>;
	/** Refunds `amountCents` more; returns the total refunded on the payment afterwards. */
	refund(input: {
		accountId: string;
		paymentIntentId: string;
		amountCents: number;
		refundApplicationFee: boolean;
		idempotencyKey: string;
	}): Promise<number>;
	refundedCents(accountId: string, paymentIntentId: string): Promise<number>;
	createAccount(input: {
		shopId: string;
		displayName: string;
		email: string | null;
		country: string;
		currency: string;
	}): Promise<string>;
	onboardingUrl(accountId: string, returnUrl: string, refreshUrl: string): Promise<string>;
	accountStatus(accountId: string): Promise<AccountStatus>;
}

let client: Stripe | null = null;

function stripe(key: string): Stripe {
	client ??= new Stripe(key, {
		maxNetworkRetries: 2,
		appInfo: { name: 'Fullcut', url: 'https://fullcut.ca' },
	});
	return client;
}

/** The live gateway, or null when STRIPE_SECRET_KEY is not set. */
export function getPaymentGateway(): PaymentGateway | null {
	const key = getStripeSecretKey();
	return key ? stripeGateway(stripe(key)) : null;
}

/** Whether this deployment can take payments at all. */
export function paymentsAvailable(): boolean {
	return getStripeSecretKey() !== null;
}

function amountRefunded(charge: string | Stripe.Charge | null | undefined): number | null {
	return charge && typeof charge !== 'string' ? charge.amount_refunded : null;
}

export function stripeGateway(api: Stripe): PaymentGateway {
	const refundedCents = async (accountId: string, paymentIntentId: string) => {
		const intent = await api.paymentIntents.retrieve(
			paymentIntentId,
			{ expand: ['latest_charge'] },
			{ stripeContext: accountId },
		);
		return amountRefunded(intent.latest_charge) ?? 0;
	};

	return {
		async createCheckout(input) {
			const metadata = { booking_id: input.bookingId, shop_id: input.shopId };
			const session = await api.checkout.sessions.create(
				{
					mode: 'payment',
					// Card only (wallets included): a completed session is always a paid one.
					allowed_payment_method_types: ['card'],
					line_items: [
						{
							quantity: 1,
							price_data: {
								currency: input.currency.toLowerCase(),
								unit_amount: input.amountCents,
								product_data: { name: input.description },
							},
						},
					],
					payment_intent_data: {
						description: input.description,
						metadata,
						...(input.platformFeeCents > 0
							? { application_fee_amount: input.platformFeeCents }
							: {}),
					},
					metadata,
					client_reference_id: input.bookingId,
					submit_type: 'book',
					expires_at: Math.floor(input.expiresAt / 1000),
					success_url: input.successUrl,
					cancel_url: input.cancelUrl,
					...(input.customerEmail ? { customer_email: input.customerEmail } : {}),
				},
				{ stripeContext: input.accountId, idempotencyKey: `checkout:${input.bookingId}` },
			);
			if (!session.url) throw new Error('Stripe returned a Checkout Session without a URL');
			return { sessionId: session.id, url: session.url };
		},

		async openCheckoutUrl(accountId, sessionId) {
			const session = await api.checkout.sessions.retrieve(sessionId, undefined, {
				stripeContext: accountId,
			});
			return session.status === 'open' ? session.url : null;
		},

		async expireCheckout(accountId, sessionId) {
			try {
				await api.checkout.sessions.expire(sessionId, undefined, { stripeContext: accountId });
			} catch (error) {
				// Already complete or expired: nothing left to close.
				if (!(error instanceof Stripe.errors.StripeInvalidRequestError)) throw error;
			}
		},

		async refund(input) {
			const refund = await api.refunds.create(
				{
					payment_intent: input.paymentIntentId,
					amount: input.amountCents,
					reason: 'requested_by_customer',
					...(input.refundApplicationFee ? { refund_application_fee: true } : {}),
					expand: ['charge'],
				},
				{ stripeContext: input.accountId, idempotencyKey: input.idempotencyKey },
			);
			return (
				amountRefunded(refund.charge) ??
				(await refundedCents(input.accountId, input.paymentIntentId))
			);
		},

		refundedCents,

		async createAccount(input) {
			const account = await api.v2.core.accounts.create(
				{
					display_name: input.displayName,
					...(input.email ? { contact_email: input.email } : {}),
					dashboard: 'full',
					identity: { country: input.country.toLowerCase() },
					configuration: { merchant: { capabilities: { card_payments: { requested: true } } } },
					defaults: {
						currency: input.currency.toLowerCase(),
						responsibilities: { fees_collector: 'stripe', losses_collector: 'stripe' },
					},
					metadata: { shop_id: input.shopId },
				},
				{ idempotencyKey: `account:${input.shopId}` },
			);
			return account.id;
		},

		async onboardingUrl(accountId, returnUrl, refreshUrl) {
			const link = await api.v2.core.accountLinks.create({
				account: accountId,
				use_case: {
					type: 'account_onboarding',
					account_onboarding: { return_url: returnUrl, refresh_url: refreshUrl },
				},
			});
			return link.url;
		},

		async accountStatus(accountId) {
			const account = await api.v2.core.accounts.retrieve(accountId, {
				include: ['configuration.merchant', 'requirements'],
			});
			const chargesEnabled =
				account.configuration?.merchant?.capabilities?.card_payments?.status === 'active';
			const userActionDue = (account.requirements?.entries ?? []).some(
				(entry) =>
					entry.awaiting_action_from === 'user' &&
					entry.minimum_deadline.status !== 'eventually_due',
			);
			return { chargesEnabled, detailsSubmitted: !userActionDue };
		},
	};
}
