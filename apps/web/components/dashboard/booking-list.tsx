'use client';

import { PhoneIcon, Undo2Icon } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import {
	availableActions,
	needsOutcome,
	STATUS_LABELS,
	type DashboardBooking,
} from '@/lib/dashboard/types';
import { cn } from '@/lib/utils';
import { OutcomeButtons, undoOutcome } from './outcome-buttons';
import { ConfirmationBadge, RiskBadge } from './risk-panel';
import { useNow } from './use-now';

export function calendarHref(booking: Pick<DashboardBooking, 'date' | 'id'>) {
	return `/dashboard/calendar?date=${booking.date}&booking=${booking.id}`;
}

export function StatusBadge({ status }: { status: DashboardBooking['status'] }) {
	return (
		<Badge
			variant={
				status === 'no_show' || status === 'cancelled'
					? 'destructive'
					: status === 'completed'
						? 'secondary'
						: 'outline'
			}
		>
			{STATUS_LABELS[status]}
		</Badge>
	);
}

export function RefillBadge({ className }: { className?: string }) {
	return (
		<Badge variant="secondary" className={className} data-testid="refill-badge">
			Refilled from waitlist
		</Badge>
	);
}

/** A day's bookings with one-tap outcome buttons once each appointment has ended. */
export function BookingList({
	bookings,
	showStaff,
	showDate = false,
	empty,
}: {
	bookings: DashboardBooking[];
	showStaff: boolean;
	showDate?: boolean;
	empty: string;
}) {
	const now = useNow();

	if (bookings.length === 0) {
		return (
			<p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
				{empty}
			</p>
		);
	}

	return (
		<ul className="grid gap-2">
			{bookings.map((booking) => {
				const unmarked = now !== null && needsOutcome(booking, now);
				const canUndo = now !== null && availableActions(booking, now).includes('undoOutcome');
				const done = booking.status === 'completed' || booking.status === 'no_show';
				return (
					<li
						key={booking.id}
						data-testid="booking-row"
						className={cn(
							'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 rounded-xl border bg-card p-3',
							'sm:grid-cols-[5.5rem_minmax(0,1fr)_auto_auto] sm:gap-x-4 sm:px-4',
							unmarked && 'border-amber-400 bg-amber-50 dark:bg-amber-950/30',
							done && 'border-dashed bg-transparent',
						)}
					>
						<span className="order-1 text-sm font-semibold tabular-nums sm:order-none">
							{showDate ? `${booking.dateLabel} · ` : null}
							{booking.timeLabel}
						</span>
						<div className="order-3 col-span-2 grid min-w-0 gap-0.5 sm:order-none sm:col-span-1">
							<Link href={calendarHref(booking)} className="truncate font-medium hover:underline">
								{booking.clientName}
							</Link>
							<span className="truncate text-sm text-muted-foreground">
								{booking.serviceName}
								{showStaff ? ` · ${booking.staffName}` : null}
							</span>
						</div>
						<div className="order-2 flex flex-wrap items-center justify-end gap-1.5 sm:order-none">
							{booking.risk && booking.status === 'confirmed' && !unmarked ? (
								<RiskBadge risk={booking.risk} />
							) : null}
							<ConfirmationBadge booking={booking} />
							{unmarked ? null : <StatusBadge status={booking.status} />}
						</div>
						{booking.clientPhone || unmarked || canUndo ? (
							<div className="order-4 col-span-2 flex flex-wrap items-center gap-2 sm:order-none sm:col-span-1 sm:justify-end">
								{unmarked ? (
									<OutcomeButtons bookingId={booking.id} clientName={booking.clientName} />
								) : null}
								{canUndo ? (
									<Button
										type="button"
										size="sm"
										variant="ghost"
										onClick={() => void undoOutcome(booking.id)}
										aria-label={`Undo outcome for ${booking.clientName}`}
									>
										<Undo2Icon aria-hidden="true" />
										Undo
									</Button>
								) : null}
								{booking.clientPhone ? (
									<a
										href={`tel:${booking.clientPhone}`}
										className={cn(
											buttonVariants({ variant: 'outline', size: 'icon-sm' }),
											'ml-auto sm:ml-0',
										)}
										aria-label={`Call ${booking.clientName}`}
									>
										<PhoneIcon aria-hidden="true" />
									</a>
								) : null}
							</div>
						) : null}
					</li>
				);
			})}
		</ul>
	);
}
