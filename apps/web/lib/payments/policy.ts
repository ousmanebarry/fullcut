// Deposit and refund rules (docs/adr/0009-payments-charge-model.md). Client-safe: no zod, no Luxon.
import { formatCents } from '@/lib/money/format';
import type { Instant } from '@/lib/time';

export const DEPOSIT_MODES = ['off', 'all_bookings', 'per_service'] as const;
export type DepositMode = (typeof DEPOSIT_MODES)[number];
export type DepositType = 'fixed' | 'percent';

export interface DepositPolicy {
	mode: DepositMode;
	defaultType: DepositType;
	defaultCents: number;
	defaultPercent: number;
}

export interface CancellationPolicy {
	freeCancelHours: number;
	lateCancelKeepsDeposit: boolean;
	noShowKeepsDeposit: boolean;
}

export type CancelledBy = 'client' | 'shop' | 'system';

/** Stripe's smallest CAD/USD charge; smaller deposits are not taken. */
export const MIN_DEPOSIT_CENTS = 50;

/** Hold length while the client pays; also Stripe Checkout's shortest session. */
export const HOLD_MINUTES = 30;

/** Deposit for a service under the shop's policy; 0 means no deposit is taken. */
export function depositFor(
	policy: DepositPolicy,
	service: { priceCents: number; depositCents: number },
	chargesEnabled: boolean,
): number {
	if (!chargesEnabled || policy.mode === 'off') return 0;
	const requested =
		policy.mode === 'per_service'
			? service.depositCents
			: policy.defaultType === 'percent'
				? Math.round((service.priceCents * policy.defaultPercent) / 100)
				: policy.defaultCents;
	const cents = Math.min(requested, service.priceCents);
	return cents >= MIN_DEPOSIT_CENTS ? cents : 0;
}

/** Fullcut's fee on a deposit. $0 by decision; changing it needs the product owner (ADR 0009). */
export function platformFeeCents(): number {
	return 0;
}

/**
 * How much of a paid deposit goes back when a booking is cancelled. The free window is measured in
 * real elapsed hours, so a DST change in between doesn't move it.
 */
export function refundAmount(
	policy: CancellationPolicy,
	booking: { startsAt: Instant; paidCents: number },
	cancelledAt: Instant,
	cancelledBy: CancelledBy | null,
): number {
	if (cancelledBy !== 'client') return booking.paidCents;
	const freeUntil = booking.startsAt - policy.freeCancelHours * 3_600_000;
	if (cancelledAt <= freeUntil) return booking.paidCents;
	return policy.lateCancelKeepsDeposit ? 0 : booking.paidCents;
}

const hours = (n: number) => (n === 1 ? '1 hour' : `${n} hours`);

/** The policy in plain words, as shown before paying and on the booking page. */
export function describeCancellationPolicy(
	policy: CancellationPolicy,
	depositCents: number,
	currency: string,
): string[] {
	const deposit = formatCents(depositCents, currency);
	const lines: string[] = [];
	if (!policy.lateCancelKeepsDeposit || policy.freeCancelHours === 0) {
		lines.push(`Cancel any time before your appointment and the ${deposit} deposit is refunded.`);
	} else {
		lines.push(
			`Cancel at least ${hours(policy.freeCancelHours)} before your appointment and the ${deposit} deposit is refunded. After that, the deposit is kept.`,
		);
	}
	lines.push(
		policy.noShowKeepsDeposit
			? 'If you miss the appointment, the deposit is kept.'
			: 'If you miss the appointment, the shop will refund the deposit.',
	);
	return lines;
}

export type PaymentState =
	'awaiting_payment' | 'expired' | 'paid' | 'refund_pending' | 'partially_refunded' | 'refunded';

export function paymentState(payment: {
	status: string;
	amountCents: number;
	refundDueCents: number;
	refundedCents: number;
}): PaymentState {
	if (payment.status === 'pending') return 'awaiting_payment';
	if (payment.status === 'expired') return 'expired';
	if (payment.refundDueCents > payment.refundedCents) return 'refund_pending';
	if (payment.refundedCents >= payment.amountCents) return 'refunded';
	if (payment.refundedCents > 0) return 'partially_refunded';
	return 'paid';
}

export const PAYMENT_STATE_LABELS: Record<PaymentState, string> = {
	awaiting_payment: 'Awaiting payment',
	expired: 'Not paid',
	paid: 'Paid',
	refund_pending: 'Refund pending',
	partially_refunded: 'Partly refunded',
	refunded: 'Refunded',
};
