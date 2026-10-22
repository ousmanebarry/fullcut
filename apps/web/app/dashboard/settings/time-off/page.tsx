import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { ListSkeleton } from '@/components/skeletons';
import { canEditSchedule } from '@/lib/auth/roles';
import { requireShopMember } from '@/lib/auth/session';
import { editableStaff, listStaff, listUpcomingTimeOff } from '@/lib/shop/queries';
import { formatSlotLabel, instantFromIso, localDateOf, timeZone, type Instant } from '@/lib/time';
import { AddTimeOffForm, DeleteTimeOffButton } from './time-off-forms';

export const metadata: Metadata = { title: 'Time off' };

export default function TimeOffSettingsPage() {
	return (
		<div className="grid max-w-2xl gap-4">
			<div className="grid gap-1">
				<h1 className="text-2xl font-semibold">Time off</h1>
				<p className="text-sm text-muted-foreground">No bookings are offered during time off.</p>
			</div>
			<Suspense fallback={<ListSkeleton rows={3} />}>
				<TimeOff />
			</Suspense>
		</div>
	);
}

async function TimeOff() {
	await connection();
	const ctx = await requireShopMember();
	const zone = timeZone(ctx.shop.timezone);
	const now = new Date();
	const [editable, allStaff, upcoming] = await Promise.all([
		editableStaff(ctx),
		listStaff(ctx),
		listUpcomingTimeOff(ctx, now),
	]);
	const names = new Map(allStaff.map((s) => [s.id, s.display_name]));

	if (editable.length === 0) {
		return (
			<p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
				{ctx.role === 'owner'
					? 'Add a staff member first.'
					: "Your login isn't linked to a staff profile yet. Ask the shop owner."}
			</p>
		);
	}

	return (
		<>
			<AddTimeOffForm staff={editable} today={localDateOf(now.getTime() as Instant, zone)} />
			<section className="grid gap-2" aria-labelledby="upcoming-heading">
				<h2 id="upcoming-heading" className="font-medium">
					Upcoming
				</h2>
				{upcoming.length === 0 ? (
					<p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
						No time off coming up.
					</p>
				) : (
					<ul className="grid gap-2">
						{upcoming.map((entry) => {
							const label = `${formatSlotLabel(instantFromIso(entry.starts_at), zone)} – ${formatSlotLabel(
								instantFromIso(entry.ends_at),
								zone,
							)}`;
							return (
								<li
									key={entry.id}
									className="flex items-center justify-between gap-3 rounded-lg border p-3"
								>
									<div className="grid gap-0.5 text-sm">
										<span className="font-medium">{names.get(entry.staff_id) ?? 'Staff'}</span>
										<span>{label}</span>
										{entry.reason ? (
											<span className="text-muted-foreground">{entry.reason}</span>
										) : null}
									</div>
									{canEditSchedule(ctx, entry.staff_id) ? (
										<DeleteTimeOffButton id={entry.id} label={label} />
									) : null}
								</li>
							);
						})}
					</ul>
				)}
			</section>
		</>
	);
}
