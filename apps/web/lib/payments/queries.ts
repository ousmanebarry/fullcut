import type { Db } from '@/lib/shop/settings';
import { formatSlotLabel, instantFromIso, type TimeZone } from '@/lib/time';
import { PAYMENT_STATE_LABELS, paymentState } from './policy';
import type { BookingPaymentView, PaymentListItem } from './types';

interface PaymentRow {
	status: string;
	amount_cents: number;
	refund_due_cents: number;
	refunded_cents: number;
}

function stateOf(row: PaymentRow) {
	const state = paymentState({
		status: row.status,
		amountCents: row.amount_cents,
		refundDueCents: row.refund_due_cents,
		refundedCents: row.refunded_cents,
	});
	return { state, stateLabel: PAYMENT_STATE_LABELS[state] };
}

/** The deposit on one booking, for the booking drawer (any member; RLS applies). */
export async function loadBookingPayment(
	db: Db,
	shopId: string,
	bookingId: string,
	zone: TimeZone,
): Promise<BookingPaymentView | null> {
	const { data, error } = await db
		.from('payments')
		.select(
			'status, amount_cents, platform_fee_cents, currency, refund_due_cents, refunded_cents, paid_at, refund_error, no_show_keeps_deposit',
		)
		.eq('shop_id', shopId)
		.eq('booking_id', bookingId)
		.maybeSingle();
	if (error) throw error;
	if (!data) return null;
	const { state, stateLabel } = stateOf(data);
	return {
		amountCents: data.amount_cents,
		platformFeeCents: data.platform_fee_cents,
		currency: data.currency,
		state,
		stateLabel,
		refundedCents: data.refunded_cents,
		paidLabel: data.paid_at ? formatSlotLabel(instantFromIso(data.paid_at), zone) : null,
		refundError: data.refund_error,
		noShowKeepsDeposit: data.no_show_keeps_deposit,
		refundable: data.status === 'succeeded' && data.refund_due_cents < data.amount_cents,
	};
}

export const PAYMENTS_PAGE_SIZE = 50;

/** Most recent deposits first (owner-only page). */
export async function listPayments(
	db: Db,
	shopId: string,
	zone: TimeZone,
	page: number,
): Promise<{ items: PaymentListItem[]; hasMore: boolean }> {
	const from = page * PAYMENTS_PAGE_SIZE;
	const { data, error } = await db
		.from('payments')
		.select(
			'id, booking_id, status, amount_cents, platform_fee_cents, currency, refund_due_cents, refunded_cents, refund_error, paid_at, created_at, booking:bookings!payments_booking_same_shop_fk(starts_at, client:clients!bookings_client_same_shop_fk(name), service:services!bookings_service_same_shop_fk(name))',
		)
		.eq('shop_id', shopId)
		.order('created_at', { ascending: false })
		.order('id', { ascending: false })
		.range(from, from + PAYMENTS_PAGE_SIZE);
	if (error) throw error;

	const items = data.slice(0, PAYMENTS_PAGE_SIZE).map((row): PaymentListItem => {
		const { state, stateLabel } = stateOf(row);
		return {
			id: row.id,
			bookingId: row.booking_id,
			dateLabel: formatSlotLabel(instantFromIso(row.paid_at ?? row.created_at), zone),
			clientName: row.booking.client.name,
			serviceName: row.booking.service.name,
			appointmentLabel: formatSlotLabel(instantFromIso(row.booking.starts_at), zone),
			amountCents: row.amount_cents,
			platformFeeCents: row.platform_fee_cents,
			refundedCents: row.refunded_cents,
			currency: row.currency,
			state,
			stateLabel,
			refundError: row.refund_error,
		};
	});
	return { items, hasMore: data.length > PAYMENTS_PAGE_SIZE };
}
