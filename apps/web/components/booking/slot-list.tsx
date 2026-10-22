'use client';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { longDateLabel } from '@/lib/public-booking/client-dates';
import type { DayPeriod, PublicSlot } from '@/lib/public-booking/types';
import { cn } from '@/lib/utils';

const PERIODS: { id: DayPeriod; label: string }[] = [
	{ id: 'morning', label: 'Morning' },
	{ id: 'afternoon', label: 'Afternoon' },
	{ id: 'evening', label: 'Evening' },
];

export type SlotListState =
	| { kind: 'loading' }
	| { kind: 'error'; message: string }
	| { kind: 'week-empty'; nextOpenDate: string | null }
	| { kind: 'day'; date: string; slots: readonly PublicSlot[] };

export function SlotList({
	state,
	selected,
	idPrefix,
	onPick,
	onRetry,
	onJumpToDate,
	onJumpToNextDay,
}: {
	state: SlotListState;
	selected: PublicSlot | null;
	idPrefix: string;
	onPick: (slot: PublicSlot) => void;
	onRetry: () => void;
	onJumpToDate: (date: string) => void;
	onJumpToNextDay: () => void;
}) {
	return (
		<div aria-live="polite" aria-busy={state.kind === 'loading'} className="grid gap-4">
			{state.kind === 'loading' ? (
				<>
					<span className="sr-only">Loading times…</span>
					<div className="grid grid-cols-3 gap-2" aria-hidden>
						{Array.from({ length: 9 }, (_, i) => (
							<Skeleton key={i} className="h-11 rounded-lg" />
						))}
					</div>
				</>
			) : state.kind === 'error' ? (
				<div className="grid justify-items-start gap-2">
					<p role="alert" className="text-sm text-destructive">
						{state.message}
					</p>
					<Button type="button" variant="outline" onClick={onRetry}>
						Try again
					</Button>
				</div>
			) : state.kind === 'week-empty' ? (
				<div className="grid justify-items-start gap-2">
					<p className="text-sm">No open times this week.</p>
					{state.nextOpenDate ? (
						<Button
							type="button"
							variant="outline"
							className="min-h-11"
							onClick={() => state.nextOpenDate && onJumpToDate(state.nextOpenDate)}
						>
							Jump to {longDateLabel(state.nextOpenDate)}
						</Button>
					) : (
						<p className="text-sm text-muted-foreground">
							There are no online openings right now. Please contact the shop.
						</p>
					)}
				</div>
			) : state.slots.length === 0 ? (
				<div className="grid justify-items-start gap-2">
					<p className="text-sm">No times on {longDateLabel(state.date)}.</p>
					<Button type="button" variant="outline" className="min-h-11" onClick={onJumpToNextDay}>
						Jump to next open day
					</Button>
				</div>
			) : (
				PERIODS.map(({ id, label }) => {
					const periodSlots = state.slots.filter((s) => s.period === id);
					if (periodSlots.length === 0) return null;
					const headingId = `${idPrefix}-${id}`;
					return (
						<section key={id} aria-labelledby={headingId} className="grid gap-2">
							<h4 id={headingId} className="text-xs font-medium uppercase text-muted-foreground">
								{label}
							</h4>
							<ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
								{periodSlots.map((slot) => {
									const isSelected = selected?.startsAt === slot.startsAt;
									return (
										<li key={slot.startsAt}>
											<button
												type="button"
												aria-pressed={isSelected}
												aria-label={slot.label}
												onClick={() => onPick(slot)}
												className={cn(
													'min-h-11 w-full rounded-lg border px-2 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
													isSelected
														? 'border-primary bg-primary text-primary-foreground'
														: 'bg-background hover:bg-accent',
												)}
											>
												{slot.time}
											</button>
										</li>
									);
								})}
							</ul>
						</section>
					);
				})
			)}
		</div>
	);
}
