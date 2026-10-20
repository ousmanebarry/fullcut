// Client-safe shapes for payments in the dashboard.
import type { PaymentState } from './policy';

export interface BookingPaymentView {
	amountCents: number;
	platformFeeCents: number;
	currency: string;
	state: PaymentState;
	stateLabel: string;
	refundedCents: number;
	paidLabel: string | null;
	refundError: string | null;
	noShowKeepsDeposit: boolean;
	/** Some of the deposit can still be refunded. */
	refundable: boolean;
}

export interface PaymentListItem {
	id: string;
	bookingId: string;
	dateLabel: string;
	clientName: string;
	serviceName: string;
	appointmentLabel: string;
	amountCents: number;
	platformFeeCents: number;
	refundedCents: number;
	currency: string;
	state: PaymentState;
	stateLabel: string;
	refundError: string | null;
}
