import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { ListSkeleton } from '@/components/skeletons';
import { AddEntryForm } from '@/components/dashboard/add-waitlist-entry';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { requireShopMember } from '@/lib/auth/session';
import { currentInstant } from '@/lib/dashboard/views';
import { loadActiveServices, loadActiveStaff } from '@/lib/public-booking/data';
import { createClient } from '@/lib/supabase/server';
import { localDateOf, plusDays, timeZone } from '@/lib/time';
import { OFFER_STATUS_LABELS, listActiveEntries, listRecentOffers } from '@/lib/waitlist/dashboard';
import { cancelEntryAction } from './actions';

export const metadata: Metadata = { title: 'Waitlist' };

export default function WaitlistPage() {
	return (
		<div className="mx-auto grid w-full max-w-5xl gap-6">
			<PageHeader
				title="Waitlist"
				description="When a booking is cancelled or moved, matching clients here get a text. The first to tap books the slot."
			/>
			<Suspense fallback={<ListSkeleton label="Loading waitlist…" />}>
				<Waitlist />
			</Suspense>
		</div>
	);
}

async function Waitlist() {
	const ctx = await requireShopMember();
	const db = await createClient();
	const zone = timeZone(ctx.shop.timezone);
	const now = currentInstant();
	const [entries, offers, services, staff] = await Promise.all([
		listActiveEntries(db, ctx.shop.id, zone, now),
		listRecentOffers(db, ctx.shop.id, zone),
		loadActiveServices(db, ctx.shop.id),
		loadActiveStaff(db, ctx.shop.id),
	]);
	const today = localDateOf(now, zone);

	return (
		<>
			{!ctx.shop.waitlist_enabled ? (
				<p className="rounded-lg border border-dashed p-4 text-sm">
					The waitlist is off, so clients can&apos;t join and freed slots aren&apos;t offered.{' '}
					{ctx.role === 'owner' ? (
						<Link href="/dashboard/settings/waitlist" className="font-medium underline">
							Turn it on in Settings
						</Link>
					) : (
						'Ask the shop owner to turn it on.'
					)}
				</p>
			) : null}

			<section aria-labelledby="entries-title" className="grid gap-3">
				<h2 id="entries-title" className="text-lg font-semibold">
					Waiting ({entries.length})
				</h2>
				{entries.length === 0 ? (
					<p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
						Nobody is on the waitlist.
					</p>
				) : (
					<ul className="grid gap-2" aria-label="Active waitlist entries">
						{entries.map((e) => (
							<li
								key={e.id}
								data-testid="waitlist-entry"
								className="flex items-start justify-between gap-3 rounded-xl border bg-card p-4"
							>
								<div className="grid min-w-0 gap-0.5 text-sm">
									<Link
										href={`/dashboard/clients/${e.clientId}`}
										className="font-medium hover:underline"
									>
										{e.clientName}
									</Link>
									<span>
										{e.serviceName} · {e.staffName ?? 'Anyone'}
									</span>
									<span className="text-muted-foreground">
										{e.datesLabel} · {e.windowsLabel}
									</span>
									<span className="text-xs text-muted-foreground">
										Waiting {e.ageLabel} ·{' '}
										{e.requestMethod === 'staff' ? 'Added by staff' : 'Joined online'}
									</span>
								</div>
								<form action={cancelEntryAction}>
									<input type="hidden" name="id" value={e.id} />
									<Button type="submit" size="sm" variant="outline">
										Remove
									</Button>
								</form>
							</li>
						))}
					</ul>
				)}
			</section>

			{ctx.shop.waitlist_enabled && services.length > 0 ? (
				<details className="rounded-lg border p-4">
					<summary className="cursor-pointer text-sm font-medium">Add a client</summary>
					<div className="pt-4">
						<AddEntryForm
							services={services.map((s) => ({ id: s.id, name: s.name }))}
							staff={staff}
							today={today}
							defaultLatest={plusDays(today, 14)}
						/>
					</div>
				</details>
			) : null}

			<section aria-labelledby="offers-title" className="grid gap-3">
				<h2 id="offers-title" className="text-lg font-semibold">
					Recent offers
				</h2>
				{offers.length === 0 ? (
					<p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
						No slots offered yet.
					</p>
				) : (
					<>
						<ul className="grid gap-2 md:hidden">
							{offers.map((o) => (
								<li key={o.id} className="grid gap-1 rounded-xl border bg-card p-4 text-sm">
									<div className="flex items-start justify-between gap-2">
										<span className="font-medium">{o.slotLabel}</span>
										<Badge variant={o.status === 'claimed' ? 'default' : 'secondary'}>
											{OFFER_STATUS_LABELS[o.status]}
										</Badge>
									</div>
									<span>
										{o.clientName} · {o.serviceName}
									</span>
									<span className="text-muted-foreground">
										{o.staffName} · Texted {o.sentLabel} · Wave {o.wave}
									</span>
								</li>
							))}
						</ul>
						<div className="hidden overflow-x-auto rounded-lg border md:block">
							<table className="w-full text-sm">
								<thead className="bg-muted/50 text-left">
									<tr>
										<th className="px-3 py-2 font-medium">Slot</th>
										<th className="px-3 py-2 font-medium">Client</th>
										<th className="px-3 py-2 font-medium">Service</th>
										<th className="px-3 py-2 font-medium">Texted</th>
										<th className="px-3 py-2 font-medium">Outcome</th>
									</tr>
								</thead>
								<tbody>
									{offers.map((o) => (
										<tr key={o.id} className="border-t">
											<td className="px-3 py-2">
												{o.slotLabel}
												<span className="block text-xs text-muted-foreground">{o.staffName}</span>
											</td>
											<td className="px-3 py-2">{o.clientName}</td>
											<td className="px-3 py-2">{o.serviceName}</td>
											<td className="px-3 py-2">
												{o.sentLabel}
												<span className="block text-xs text-muted-foreground">Wave {o.wave}</span>
											</td>
											<td className="px-3 py-2">
												<Badge variant={o.status === 'claimed' ? 'default' : 'secondary'}>
													{OFFER_STATUS_LABELS[o.status]}
												</Badge>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</>
				)}
			</section>
		</>
	);
}
