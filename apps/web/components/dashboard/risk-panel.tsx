'use client';

import { ShieldCheckIcon } from 'lucide-react';
import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';
import {
	markClientConfirmedAction,
	setBookingTrustAction,
	standbyAction,
} from '@/app/dashboard/bookings/actions';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import type { DashboardBooking } from '@/lib/dashboard/types';
import { CONFIRMATION_LABELS, RISK_TIER_LABELS, type BookingRisk } from '@/lib/risk/types';
import type { StandbyCandidate } from '@/lib/waitlist/standby';
import { cn } from '@/lib/utils';

const TIER_CLASSES: Record<BookingRisk['tier'], string> = {
	low: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200',
	medium: 'border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200',
	high: 'border-red-300 bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-200',
	unknown: 'border-border text-muted-foreground',
};

export function RiskBadge({ risk, className }: { risk: BookingRisk; className?: string }) {
	if (risk.trusted) {
		return (
			<Badge variant="outline" className={className} data-testid="risk-badge">
				<ShieldCheckIcon aria-hidden="true" />
				Trusted
			</Badge>
		);
	}
	return (
		<Badge
			variant="outline"
			className={cn(TIER_CLASSES[risk.tier], className)}
			data-testid="risk-badge"
		>
			{RISK_TIER_LABELS[risk.tier]}
		</Badge>
	);
}

/** Calendar/list flag for bookings waiting on, or past, a confirmation deadline. */
export function ConfirmationBadge({
	booking,
	className,
}: {
	booking: Pick<DashboardBooking, 'confirmation'>;
	className?: string;
}) {
	if (booking.confirmation === 'unconfirmed') {
		return (
			<Badge variant="destructive" className={className} data-testid="confirmation-badge">
				Unconfirmed
			</Badge>
		);
	}
	if (booking.confirmation === 'released') {
		return (
			<Badge variant="secondary" className={className} data-testid="confirmation-badge">
				Released
			</Badge>
		);
	}
	return null;
}

/** Risk, confirmation timeline and standby clients for one booking, in the booking drawer. */
export function RiskSection({ booking, isOwner }: { booking: DashboardBooking; isOwner: boolean }) {
	const { risk } = booking;
	const [pending, startTransition] = useTransition();
	const active = booking.status === 'confirmed';
	const awaiting = booking.confirmation === 'requested' || booking.confirmation === 'unconfirmed';

	if (!risk && booking.confirmation === 'not_required') return null;

	const run = (action: () => Promise<{ ok: boolean; message: string }>) =>
		startTransition(async () => {
			const result = await action();
			if (result.ok) toast.success(result.message);
			else toast.error(result.message);
		});

	return (
		<section aria-labelledby="risk-heading" className="grid gap-3 rounded-lg border p-3">
			<div className="flex flex-wrap items-center gap-2">
				<h3 id="risk-heading" className="text-sm font-medium">
					No-show risk
				</h3>
				{risk ? <RiskBadge risk={risk} /> : null}
				<ConfirmationBadge booking={booking} />
			</div>

			{risk && risk.tier !== 'unknown' ? (
				<details className="text-sm">
					<summary className="cursor-pointer text-muted-foreground">Why this rating?</summary>
					<ul className="mt-2 list-disc pl-5" data-testid="risk-factors">
						{risk.factors.map((factor) => (
							<li key={factor}>{factor}</li>
						))}
					</ul>
					<p className="mt-2 text-muted-foreground">
						{risk.method === 'model'
							? 'Estimated by a model trained on bookings at shops like yours.'
							: "Estimated from this client's history with you and how far ahead they booked."}{' '}
						It&apos;s a guide, not a judgement: nothing is sent or changed unless you turned that on
						in settings, and you can trust any client below. Age, gender and where someone lives are
						never used.
					</p>
				</details>
			) : risk ? (
				<p className="text-sm text-muted-foreground">
					We couldn&apos;t rate this booking, so it&apos;s handled like any other.
				</p>
			) : null}

			{booking.confirmation !== 'not_required' ? (
				<p className="text-sm" data-testid="confirmation-timeline">
					{CONFIRMATION_LABELS[booking.confirmation]}
					{awaiting && booking.confirmationDueLabel
						? ` · deadline ${booking.confirmationDueLabel}`
						: null}
					{booking.confirmation === 'unconfirmed'
						? '. The client did not reply in time; call them, keep the booking, or cancel it.'
						: null}
				</p>
			) : null}

			{active ? (
				<div className="flex flex-wrap gap-2">
					{awaiting ? (
						<Button
							type="button"
							size="sm"
							variant="outline"
							disabled={pending}
							onClick={() => run(() => markClientConfirmedAction(booking.id))}
						>
							Client confirmed
						</Button>
					) : null}
					{isOwner && risk ? (
						<Button
							type="button"
							size="sm"
							variant="ghost"
							disabled={pending}
							onClick={() => run(() => setBookingTrustAction(booking.id, !risk.trusted))}
						>
							<ShieldCheckIcon aria-hidden="true" />
							{risk.trusted ? 'Stop trusting' : 'Trust this client'}
						</Button>
					) : null}
				</div>
			) : null}

			{active ? (
				<Standby bookingId={booking.id} version={`${booking.confirmation}:${risk?.tier}`} />
			) : null}
		</section>
	);
}

function Standby({ bookingId, version }: { bookingId: string; version: string }) {
	const [candidates, setCandidates] = useState<StandbyCandidate[] | null>(null);

	useEffect(() => {
		let current = true;
		void standbyAction(bookingId).then((result) => {
			if (current) setCandidates(result);
		});
		return () => {
			current = false;
		};
	}, [bookingId, version]);

	if (candidates === null) return null;
	return (
		<div className="grid gap-1 text-sm" data-testid="standby">
			<p className="font-medium">Standby from your waitlist</p>
			{candidates.length === 0 ? (
				<p className="text-muted-foreground">Nobody on the waitlist fits this time.</p>
			) : (
				<ul className="grid gap-1">
					{candidates.map((c) => (
						<li key={c.clientId} className="flex flex-wrap items-center justify-between gap-2">
							<span>
								{c.clientName}
								<span className="text-muted-foreground">
									{' · '}
									{c.serviceName}, {c.startsLabel}
								</span>
							</span>
							{c.phone ? (
								<a
									href={`tel:${c.phone}`}
									className={buttonVariants({ variant: 'outline', size: 'sm' })}
								>
									Call
								</a>
							) : null}
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
