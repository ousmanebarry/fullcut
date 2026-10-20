import type { Db } from '@/lib/shop/settings';
import type { Instant } from '@/lib/time';
import { closeDepositCheckout } from './checkout';
import type { PaymentGateway } from './gateway';
import { decideRefunds, sendDueRefunds, type PaymentScope } from './refunds';

/**
 * Follow-up after any cancellation: decides the refund, closes an unpaid checkout and sends what's owed.
 * Never throws for Stripe problems; anything left owed is retried by the job tick.
 */
export async function settleCancelledBooking(
	db: Db,
	gateway: PaymentGateway | null,
	scope: PaymentScope,
	now: Instant,
): Promise<void> {
	try {
		await decideRefunds(db, now, scope);
		if (!gateway) return;
		await closeDepositCheckout(db, gateway, scope.shopId, scope.bookingId);
		await sendDueRefunds(db, gateway, scope);
	} catch (cause) {
		console.error('Settling a cancelled booking failed; the job tick will retry', cause);
	}
}
