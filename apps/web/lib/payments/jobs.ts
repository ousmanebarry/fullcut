import type { Db } from '@/lib/shop/settings';
import type { Instant } from '@/lib/time';
import type { PaymentGateway } from './gateway';
import { decideRefunds, sendDueRefunds, type RefundRun } from './refunds';

export interface PaymentJobRun extends RefundRun {
	holdsReleased: number;
	refundsDecided: number;
}

/** Per-tick payment work: release lapsed holds, catch up refund decisions, send owed refunds. */
export async function runPaymentJobs(
	db: Db,
	gateway: PaymentGateway | null,
	now: Instant,
): Promise<PaymentJobRun> {
	const { data: holdsReleased, error } = await db.rpc('expire_pending_holds');
	if (error) throw error;
	const refundsDecided = await decideRefunds(db, now);
	const refunds = gateway ? await sendDueRefunds(db, gateway) : { refunded: 0, failed: 0 };
	return { holdsReleased, refundsDecided, ...refunds };
}
