import type { Db } from '@/lib/shop/settings';
import { instantFromIso, instantToIso, type Instant } from '@/lib/time';
import type { PaymentGateway } from './gateway';
import { refundAmount, type CancelledBy } from './policy';

export interface PaymentScope {
	shopId: string;
	bookingId: string;
}

const MAX_ERROR_LENGTH = 500;

/**
 * Decides, once per payment, how much of a paid deposit goes back for a cancelled booking. Callers run it
 * right after a cancellation; the job tick runs it for everything so a crash in between is caught up.
 */
export async function decideRefunds(db: Db, now: Instant, scope?: PaymentScope): Promise<number> {
	let query = db
		.from('payments')
		.select(
			'id, amount_cents, refund_due_cents, free_cancel_hours, late_cancel_keeps_deposit, no_show_keeps_deposit, booking:bookings!payments_booking_same_shop_fk!inner(status, starts_at, cancelled_at, cancelled_by)',
		)
		.eq('status', 'succeeded')
		.is('refund_decided_at', null)
		.eq('booking.status', 'cancelled')
		.limit(100);
	if (scope) query = query.eq('shop_id', scope.shopId).eq('booking_id', scope.bookingId);
	const { data, error } = await query;
	if (error) throw error;

	let decided = 0;
	for (const payment of data) {
		const { booking } = payment;
		const cents = refundAmount(
			{
				freeCancelHours: payment.free_cancel_hours,
				lateCancelKeepsDeposit: payment.late_cancel_keeps_deposit,
				noShowKeepsDeposit: payment.no_show_keeps_deposit,
			},
			{ startsAt: instantFromIso(booking.starts_at), paidCents: payment.amount_cents },
			booking.cancelled_at ? instantFromIso(booking.cancelled_at) : now,
			booking.cancelled_by as CancelledBy | null,
		);
		const { data: updated, error: updateError } = await db
			.from('payments')
			.update({
				refund_due_cents: Math.max(payment.refund_due_cents, cents),
				refund_decided_at: instantToIso(now),
			})
			.eq('id', payment.id)
			.is('refund_decided_at', null)
			.select('id');
		if (updateError) throw updateError;
		decided += updated.length;
	}
	return decided;
}

/** Owner-initiated: the whole deposit is owed back (e.g. a no-show the policy doesn't charge for). */
export async function requestFullRefund(
	db: Db,
	scope: PaymentScope,
	now: Instant,
): Promise<boolean> {
	const { data: payment, error } = await db
		.from('payments')
		.select('id, amount_cents')
		.eq('shop_id', scope.shopId)
		.eq('booking_id', scope.bookingId)
		.eq('status', 'succeeded')
		.maybeSingle();
	if (error) throw error;
	if (!payment) return false;
	const { error: updateError } = await db
		.from('payments')
		.update({ refund_due_cents: payment.amount_cents, refund_decided_at: instantToIso(now) })
		.eq('id', payment.id);
	if (updateError) throw updateError;
	return true;
}

export interface RefundRun {
	refunded: number;
	failed: number;
}

/** Sends every owed refund to Stripe. Failures stay owed (with the error shown) and are retried later. */
export async function sendDueRefunds(
	db: Db,
	gateway: PaymentGateway,
	scope?: PaymentScope,
): Promise<RefundRun> {
	let query = db
		.from('payments')
		.select(
			'id, stripe_account_id, stripe_payment_intent_id, amount_cents, platform_fee_cents, refund_due_cents, refunded_cents',
		)
		.eq('status', 'succeeded')
		.gt('refund_owed_cents', 0)
		.limit(50);
	if (scope) query = query.eq('shop_id', scope.shopId).eq('booking_id', scope.bookingId);
	const { data, error } = await query;
	if (error) throw error;

	const run: RefundRun = { refunded: 0, failed: 0 };
	for (const payment of data) {
		if (!payment.stripe_payment_intent_id) continue;
		try {
			const total = await gateway.refund({
				accountId: payment.stripe_account_id,
				paymentIntentId: payment.stripe_payment_intent_id,
				amountCents: payment.refund_due_cents - payment.refunded_cents,
				refundApplicationFee: payment.platform_fee_cents > 0,
				// Keyed by the target total, so a retry of the same decision can never refund twice.
				idempotencyKey: `refund:${payment.id}:${payment.refund_due_cents}`,
			});
			await recordRefunded(db, payment, total);
			run.refunded += 1;
		} catch (cause) {
			const message = cause instanceof Error ? cause.message : 'Refund failed';
			await db
				.from('payments')
				.update({ refund_error: message.slice(0, MAX_ERROR_LENGTH) })
				.eq('id', payment.id);
			run.failed += 1;
		}
	}
	return run;
}

/**
 * Stores Stripe's refunded total. A refund made outside Fullcut (the shop's Stripe Dashboard) raises the
 * amount due with it, so nothing is ever refunded twice.
 */
export async function recordRefunded(
	db: Db,
	payment: { id: string; amount_cents: number; refund_due_cents: number },
	totalRefundedCents: number,
): Promise<void> {
	const refunded = Math.min(Math.max(totalRefundedCents, 0), payment.amount_cents);
	const { error } = await db
		.from('payments')
		.update({
			refunded_cents: refunded,
			refund_due_cents: Math.max(payment.refund_due_cents, refunded),
			refund_error: null,
		})
		.eq('id', payment.id);
	if (error) throw error;
}
