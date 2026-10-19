'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { bulkMarkAction } from '@/app/dashboard/bookings/actions';
import { Button } from '@/components/ui/button';
import type { DashboardBooking, Outcome } from '@/lib/dashboard/types';
import { OutcomeButtons } from './outcome-buttons';

/** Past bookings waiting for an outcome: one tap per row, or select several and mark together. */
export function UnmarkedList({
	bookings,
	showStaff,
}: {
	bookings: DashboardBooking[];
	showStaff: boolean;
}) {
	const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
	const [pending, startTransition] = useTransition();
	const visible = new Set(bookings.map((b) => b.id));
	const chosen = [...selected].filter((id) => visible.has(id));
	const allChosen = bookings.length > 0 && chosen.length === bookings.length;

	const toggle = (id: string, on: boolean) =>
		setSelected((current) => {
			const next = new Set(current);
			if (on) next.add(id);
			else next.delete(id);
			return next;
		});

	const markChosen = (outcome: Outcome) =>
		startTransition(async () => {
			const result = await bulkMarkAction({ bookingIds: chosen, outcome });
			if (result.ok) {
				toast.success(result.message);
				setSelected(new Set());
			} else {
				toast.error(result.message);
			}
		});

	if (bookings.length === 0) {
		return (
			<p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
				All caught up. Every past appointment has an outcome.
			</p>
		);
	}

	return (
		<div className="grid gap-3">
			<div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-lg border bg-background p-2">
				<label className="flex items-center gap-2 px-1 text-sm">
					<input
						type="checkbox"
						className="size-4 accent-primary"
						checked={allChosen}
						onChange={(event) => setSelected(event.target.checked ? new Set(visible) : new Set())}
					/>
					Select all
				</label>
				<span className="text-sm text-muted-foreground">{chosen.length} selected</span>
				<div className="ml-auto flex gap-2">
					<Button
						type="button"
						size="sm"
						variant="outline"
						disabled={pending || chosen.length === 0}
						onClick={() => markChosen('completed')}
					>
						Mark completed
					</Button>
					<Button
						type="button"
						size="sm"
						variant="destructive"
						disabled={pending || chosen.length === 0}
						onClick={() => markChosen('no_show')}
					>
						Mark no-show
					</Button>
				</div>
			</div>
			<ul className="grid gap-2">
				{bookings.map((booking) => (
					<li
						key={booking.id}
						data-testid="unmarked-row"
						className="flex flex-wrap items-center gap-3 rounded-lg border p-3"
					>
						<input
							type="checkbox"
							className="size-4 accent-primary"
							checked={selected.has(booking.id)}
							onChange={(event) => toggle(booking.id, event.target.checked)}
							aria-label={`Select ${booking.clientName}, ${booking.dateLabel} ${booking.timeLabel}`}
						/>
						<div className="grid min-w-0 flex-1 gap-0.5 text-sm">
							<span className="font-medium tabular-nums">
								{booking.dateLabel} · {booking.timeLabel}
							</span>
							<span className="truncate">
								<span className="font-medium">{booking.clientName}</span>
								<span className="text-muted-foreground">
									{' · '}
									{booking.serviceName}
									{showStaff ? ` · ${booking.staffName}` : null}
								</span>
							</span>
						</div>
						<OutcomeButtons bookingId={booking.id} clientName={booking.clientName} />
					</li>
				))}
			</ul>
		</div>
	);
}
