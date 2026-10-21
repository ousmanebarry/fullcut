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
							'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border p-3',
							unmarked && 'border-amber-400 bg-amber-50 dark:bg-amber-950/30',
							done && 'opacity-70',
						)}
					>
						<div className="grid min-w-0 flex-1 gap-0.5 text-sm">
							<span className="font-medium tabular-nums">
								{showDate ? `${booking.dateLabel} · ` : null}
								{booking.timeLabel}
							</span>
							<span className="truncate">
								<Link href={calendarHref(booking)} className="font-medium hover:underline">
									{booking.clientName}
								</Link>
								<span className="text-muted-foreground">
									{' · '}
									{booking.serviceName}
									{showStaff ? ` · ${booking.staffName}` : null}
								</span>
							</span>
						</div>
						{booking.clientPhone ? (
							<a
								href={`tel:${booking.clientPhone}`}
								className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}
								aria-label={`Call ${booking.clientName}`}
							>
								<PhoneIcon aria-hidden="true" />
							</a>
						) : null}
						{booking.risk && booking.status === 'confirmed' && !unmarked ? (
							<RiskBadge risk={booking.risk} />
						) : null}
						<ConfirmationBadge booking={booking} />
						{unmarked ? (
							<OutcomeButtons bookingId={booking.id} clientName={booking.clientName} />
						) : (
							<StatusBadge status={booking.status} />
						)}
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
					</li>
				);
			})}
		</ul>
	);
}
