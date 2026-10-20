'use client';

import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { bookingPaymentAction, refundDepositAction } from '@/app/dashboard/bookings/actions';
import { Button } from '@/components/ui/button';
import type { BookingStatus } from '@/lib/booking/types';
import { formatCents } from '@/lib/money/format';
import type { BookingPaymentView } from '@/lib/payments/types';

/** The booking's deposit, if any; owners can refund what's left of it. */
export function BookingPayment({
	bookingId,
	status,
	isOwner,
	version,
}: {
	bookingId: string;
	status: BookingStatus;
	isOwner: boolean;
	version: string;
}) {
	const [payment, setPayment] = useState<BookingPaymentView | null | undefined>(undefined);
	const [confirming, setConfirming] = useState(false);
	const [pending, startTransition] = useTransition();
	const [reload, setReload] = useState(0);

	useEffect(() => {
		let current = true;
		void bookingPaymentAction(bookingId).then((result) => {
			if (current) setPayment(result);
		});
		return () => {
			current = false;
		};
	}, [bookingId, version, reload]);

	if (payment === undefined || payment === null) return null;

	const refund = () =>
		startTransition(async () => {
			const result = await refundDepositAction(bookingId);
			if (result.ok) toast.success(result.message);
			else toast.error(result.message);
			setConfirming(false);
			setReload((n) => n + 1);
		});

	const owedOnNoShow = status === 'no_show' && !payment.noShowKeepsDeposit && payment.refundable;

	return (
		<section aria-labelledby="booking-payment-heading" className="grid gap-2">
			<h3 id="booking-payment-heading" className="text-sm font-medium">
				Deposit
			</h3>
			<p className="flex flex-wrap justify-between gap-x-3 text-sm">
				<span>
					{formatCents(payment.amountCents, payment.currency)}
					{payment.platformFeeCents > 0
						? ` (Fullcut fee ${formatCents(payment.platformFeeCents, payment.currency)})`
						: ' · no Fullcut fee'}
				</span>
				<span className="text-muted-foreground">
					{payment.stateLabel}
					{payment.paidLabel ? ` · ${payment.paidLabel}` : ''}
				</span>
			</p>
			{payment.refundedCents > 0 ? (
				<p className="text-sm">Refunded {formatCents(payment.refundedCents, payment.currency)}</p>
			) : null}
			{payment.refundError ? (
				<p className="text-sm text-destructive">{payment.refundError} · will be retried</p>
			) : null}
			{owedOnNoShow ? (
				<p className="text-sm">
					Your policy refunds the deposit for no-shows.
					{isOwner ? '' : ' Ask the owner to refund it.'}
				</p>
			) : null}
			{isOwner && payment.refundable ? (
				confirming ? (
					<div className="flex flex-wrap items-center gap-2">
						<span className="text-sm">
							Refund {formatCents(payment.amountCents - payment.refundedCents, payment.currency)} to
							the client?
						</span>
						<Button type="button" variant="destructive" disabled={pending} onClick={refund}>
							{pending ? 'Refunding…' : 'Yes, refund'}
						</Button>
						<Button
							type="button"
							variant="outline"
							disabled={pending}
							onClick={() => setConfirming(false)}
						>
							Keep it
						</Button>
					</div>
				) : (
					<Button
						type="button"
						variant={owedOnNoShow ? 'default' : 'outline'}
						className="justify-self-start"
						onClick={() => setConfirming(true)}
					>
						Refund deposit
					</Button>
				)
			) : null}
		</section>
	);
}
