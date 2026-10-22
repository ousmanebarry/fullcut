'use client';

import { CoffeeIcon, PlusIcon } from 'lucide-react';
import { buildAgenda, isClosedAllDay, minuteLabel } from '@/lib/dashboard/agenda';
import type { LayoutColumn } from '@/lib/dashboard/calendar-layout';
import { isRefill, needsOutcome, type DashboardBooking } from '@/lib/dashboard/types';
import { cn } from '@/lib/utils';
import { RefillBadge, StatusBadge } from './booking-list';
import { isRiskyBooking, STATUS_CLASSES } from './calendar-grid';
import { OutcomeButtons } from './outcome-buttons';
import { ConfirmationBadge, RiskBadge } from './risk-panel';
import { minuteToTime, useNow, zonedMinuteOfDay } from './use-now';

export function CalendarAgenda({
	column,
	bookings,
	today,
	timezone,
	onOpenBooking,
	onCreateAt,
	className,
}: {
	column: LayoutColumn;
	bookings: ReadonlyMap<string, DashboardBooking>;
	today: string;
	timezone: string;
	onOpenBooking: (bookingId: string) => void;
	onCreateAt: (column: LayoutColumn, time: string) => void;
	className?: string;
}) {
	const now = useNow();
	// Only offer free time that is still ahead.
	const notBefore =
		column.date < today
			? 1440
			: column.date === today
				? now === null
					? 1440
					: zonedMinuteOfDay(timezone, now)
				: 0;
	const items = buildAgenda(column, notBefore);
	const closed = isClosedAllDay(column);

	return (
		<div data-testid="calendar-agenda" className={cn('grid gap-2', className)}>
			{items.length === 0 ? (
				<p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
					{closed ? 'Closed this day.' : 'Nothing booked.'}
				</p>
			) : null}
			<ul className="grid gap-2">
				{items.map((item) => {
					if (item.kind === 'free') {
						return (
							<li key={`free-${item.startMin}`}>
								<button
									type="button"
									onClick={() => onCreateAt(column, minuteToTime(item.startMin))}
									className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-dashed px-4 py-2 text-left text-sm text-muted-foreground hover:border-primary/50 hover:bg-primary/5 hover:text-foreground"
								>
									<span className="w-[4.5rem] shrink-0 whitespace-nowrap tabular-nums">
										{minuteLabel(item.startMin)}
									</span>
									<span className="flex-1">Free until {minuteLabel(item.endMin)}</span>
									<span className="flex items-center gap-1 font-medium text-primary">
										<PlusIcon aria-hidden className="size-4" />
										Book
									</span>
								</button>
							</li>
						);
					}
					if (item.kind === 'time_off') {
						return (
							<li
								key={`off-${item.startMin}`}
								className="flex min-h-12 items-center gap-3 rounded-xl bg-muted px-4 py-2 text-sm text-muted-foreground"
							>
								<span className="w-[4.5rem] shrink-0 whitespace-nowrap tabular-nums">
									{minuteLabel(item.startMin)}
								</span>
								<span className="flex flex-1 items-center gap-2">
									<CoffeeIcon aria-hidden className="size-4" />
									Time off until {minuteLabel(item.endMin)}
								</span>
							</li>
						);
					}
					const booking = bookings.get(item.bookingId);
					if (!booking) return null;
					const unmarked = now !== null && needsOutcome(booking, now);
					return (
						<li
							key={booking.id}
							className={cn(
								'grid overflow-hidden rounded-xl border',
								unmarked
									? 'border-amber-500 bg-amber-50 dark:bg-amber-950/30'
									: STATUS_CLASSES[booking.status],
							)}
						>
							<button
								type="button"
								onClick={() => onOpenBooking(booking.id)}
								className="flex w-full gap-3 px-4 py-3 text-left hover:bg-foreground/5 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
							>
								<span
									aria-hidden
									className="w-[4.5rem] shrink-0 text-sm font-semibold whitespace-nowrap tabular-nums"
								>
									{minuteLabel(item.startMin)}
								</span>
								<span className="grid min-w-0 flex-1 gap-1">
									<span className="truncate font-medium text-foreground">{booking.clientName}</span>
									<span className="truncate text-sm text-muted-foreground">
										{booking.serviceName} · {booking.timeLabel}
									</span>
									<span className="flex flex-wrap gap-1.5 empty:hidden">
										{isRiskyBooking(booking) && booking.risk ? (
											<RiskBadge risk={booking.risk} />
										) : null}
										<ConfirmationBadge booking={booking} />
										{isRefill(booking) ? <RefillBadge /> : null}
										{booking.status !== 'confirmed' && !unmarked ? (
											<StatusBadge status={booking.status} />
										) : null}
									</span>
								</span>
							</button>
							{unmarked ? (
								<div className="border-t border-amber-500/40 px-4 py-2">
									<OutcomeButtons bookingId={booking.id} clientName={booking.clientName} />
								</div>
							) : null}
						</li>
					);
				})}
			</ul>
		</div>
	);
}
