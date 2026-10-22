'use client';

import type { CalendarLayout, LayoutColumn } from '@/lib/dashboard/calendar-layout';
import { isRefill, needsOutcome, type DashboardBooking } from '@/lib/dashboard/types';
import { cn } from '@/lib/utils';
import { RefillBadge } from './booking-list';
import { OutcomeButtons } from './outcome-buttons';
import { ConfirmationBadge } from './risk-panel';
import { minuteToTime, useNow, zonedMinuteOfDay } from './use-now';

const PX_PER_MIN = 1.4;
const TAP_SNAP_MIN = 15;
const MIN_BLOCK_PX = 18;
const TALL_BLOCK_PX = 44;

const STATUS_CLASSES: Record<DashboardBooking['status'], string> = {
	pending: 'border-dashed border-primary/50 bg-primary/5',
	confirmed: 'border-primary/50 bg-primary/15',
	completed: 'border-border bg-muted text-neutral-600 dark:text-muted-foreground',
	no_show: 'border-destructive/40 bg-destructive/10 text-red-700 dark:text-destructive',
	cancelled: 'border-border bg-background text-neutral-600 line-through dark:text-muted-foreground',
};

export function CalendarGrid({
	layout,
	bookings,
	today,
	timezone,
	phoneColumnKey,
	onOpenBooking,
	onCreateAt,
}: {
	layout: CalendarLayout;
	bookings: ReadonlyMap<string, DashboardBooking>;
	today: string;
	timezone: string;
	/** On small screens only this column is shown (staff tabs switch it). */
	phoneColumnKey: string | null;
	onOpenBooking: (bookingId: string) => void;
	onCreateAt: (column: LayoutColumn, time: string) => void;
}) {
	const now = useNow();
	const heightPx = (layout.endMin - layout.startMin) * PX_PER_MIN;
	const y = (minute: number) => (minute - layout.startMin) * PX_PER_MIN;
	const nowMin = now === null ? null : zonedMinuteOfDay(timezone, now);
	const showNow = nowMin !== null && nowMin >= layout.startMin && nowMin < layout.endMin;

	return (
		<div className="overflow-x-auto rounded-lg border" data-testid="calendar-grid">
			<div className="flex min-w-full">
				<div className="sticky left-0 z-20 w-14 shrink-0 border-r bg-background">
					<div className="h-10 border-b" />
					<div className="relative" style={{ height: heightPx }} aria-hidden="true">
						{layout.hours.map((hour) => (
							<span
								key={hour.minute}
								className="absolute right-1.5 -translate-y-1/2 text-[0.7rem] text-muted-foreground tabular-nums first:translate-y-0"
								style={{ top: y(hour.minute) }}
							>
								{hour.label}
							</span>
						))}
					</div>
				</div>

				{layout.columns.map((column) => (
					<div
						key={column.key}
						className={cn(
							'min-w-36 flex-1 border-r last:border-r-0',
							phoneColumnKey !== null && column.key !== phoneColumnKey
								? 'hidden md:block'
								: 'block',
						)}
						data-testid="calendar-column"
						data-column={column.title}
					>
						<div
							className={cn(
								'sticky top-0 z-10 flex h-10 items-center justify-center border-b bg-background px-2 text-sm font-medium',
								column.date === today && layout.columns.length === 7 && 'text-primary',
							)}
						>
							<span className="truncate">{column.title}</span>
						</div>
						{/* Tapping empty space starts a booking; keyboard users have the New booking button. */}
						<div
							className="relative cursor-copy"
							style={{ height: heightPx }}
							onClick={(event) => {
								if (event.target !== event.currentTarget) return;
								const rect = event.currentTarget.getBoundingClientRect();
								const minute = layout.startMin + (event.clientY - rect.top) / PX_PER_MIN;
								const snapped = Math.floor(minute / TAP_SNAP_MIN) * TAP_SNAP_MIN;
								onCreateAt(column, minuteToTime(Math.max(0, Math.min(1439, snapped))));
							}}
						>
							{layout.hours.map((hour) => (
								<div
									key={hour.minute}
									className="pointer-events-none absolute inset-x-0 border-t border-border/60"
									style={{ top: y(hour.minute) }}
								/>
							))}
							{column.shades.map((shade, i) => (
								<div
									key={i}
									className={cn(
										'pointer-events-none absolute inset-x-0',
										shade.kind === 'closed'
											? 'bg-muted/70'
											: 'bg-[repeating-linear-gradient(135deg,var(--color-muted)_0_6px,transparent_6px_12px)]',
									)}
									style={{ top: y(shade.topMin), height: shade.heightMin * PX_PER_MIN }}
								>
									{shade.kind === 'time_off' ? (
										<span className="px-1 text-[0.7rem] text-muted-foreground">Time off</span>
									) : null}
								</div>
							))}

							{column.blocks.map((block) => {
								const booking = bookings.get(block.bookingId);
								if (!booking) return null;
								const unmarked = now !== null && needsOutcome(booking, now);
								const blockPx = Math.max(MIN_BLOCK_PX, block.heightMin * PX_PER_MIN);
								const tall = blockPx >= TALL_BLOCK_PX;
								const risky =
									booking.status === 'confirmed' &&
									booking.risk !== null &&
									!booking.risk.trusted &&
									(booking.risk.tier === 'high' || booking.risk.tier === 'medium');
								const flags = [
									isRefill(booking) ? 'refilled from waitlist' : null,
									risky ? `${booking.risk?.tier} no-show risk` : null,
									booking.confirmation === 'unconfirmed' ? 'unconfirmed' : null,
									booking.confirmation === 'released' ? 'released' : null,
								].filter(Boolean);
								return (
									<div
										key={block.bookingId}
										className="absolute px-0.5"
										style={{
											top: y(block.topMin),
											left: `${(block.lane / block.lanes) * 100}%`,
											width: `${100 / block.lanes}%`,
										}}
									>
										<div
											data-testid="calendar-block"
											className={cn(
												'relative overflow-hidden rounded-md border text-xs',
												unmarked
													? 'border-amber-500 bg-amber-100 dark:bg-amber-900/40'
													: STATUS_CLASSES[booking.status],
											)}
											style={{ height: blockPx }}
										>
											<button
												type="button"
												className="absolute inset-0 rounded-md hover:bg-foreground/5 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
												onClick={() => onOpenBooking(booking.id)}
												aria-label={`${booking.clientName}, ${booking.serviceName}, ${booking.timeLabel}${flags.length > 0 ? `, ${flags.join(', ')}` : ''}`}
											/>
											{risky ? (
												<span
													aria-hidden="true"
													data-testid="risk-dot"
													data-tier={booking.risk?.tier}
													className={cn(
														'pointer-events-none absolute top-1 left-0.5 size-1.5 rounded-full',
														booking.risk?.tier === 'high' ? 'bg-red-500' : 'bg-amber-500',
													)}
												/>
											) : null}
											<div
												className={cn(
													'pointer-events-none relative px-1.5 py-0.5',
													unmarked && 'pr-14',
												)}
											>
												<p className="truncate font-medium">{booking.clientName}</p>
												{tall ? (
													<p className="truncate">
														{booking.serviceName} · {booking.timeLabel}
													</p>
												) : null}
												{tall && isRefill(booking) ? (
													<RefillBadge className="mt-0.5 h-4 px-1.5 text-[10px]" />
												) : null}
												{tall ? (
													<ConfirmationBadge
														booking={booking}
														className="mt-0.5 h-4 px-1.5 text-[10px]"
													/>
												) : null}
											</div>
											{unmarked ? (
												<div className="absolute top-0.5 right-0.5">
													<OutcomeButtons
														bookingId={booking.id}
														clientName={booking.clientName}
														compact
													/>
												</div>
											) : null}
										</div>
										{block.bufferMin > 0 ? (
											<div
												aria-hidden="true"
												className="rounded-b-md border-x border-b border-dashed border-primary/30 bg-primary/5"
												style={{ height: block.bufferMin * PX_PER_MIN }}
											/>
										) : null}
									</div>
								);
							})}

							{showNow && column.date === today ? (
								<div
									aria-hidden="true"
									className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-red-500"
									style={{ top: y(nowMin) }}
								>
									<span className="absolute -top-1 -left-1 size-2 rounded-full bg-red-500" />
								</div>
							) : null}
						</div>
					</div>
				))}
			</div>
		</div>
	);
}
