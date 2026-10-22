import { ArrowLeftIcon, CalendarPlusIcon } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { ListSkeleton } from '@/components/skeletons';
import { ClientNotes } from '@/components/clients/client-notes';
import { ClientContactForm } from '@/components/clients/contact-form';
import { DeleteClientButton } from '@/components/clients/delete-client-button';
import { BookingList } from '@/components/dashboard/booking-list';
import { buttonVariants } from '@/components/ui/button';
import { requireShopMember } from '@/lib/auth/session';
import { loadClientProfile, PAST_SHOWN } from '@/lib/clients/queries';
import { bookAgainHref } from '@/lib/clients/types';
import { idSchema } from '@/lib/dashboard/schemas';
import { SOURCE_LABELS } from '@/lib/dashboard/types';
import { currentInstant } from '@/lib/dashboard/views';
import { formatCents } from '@/lib/money/format';
import { toBookingShop } from '@/lib/public-booking/data';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Client' };

export default function ClientPage({ params }: PageProps<'/dashboard/clients/[id]'>) {
	return (
		<div className="mx-auto grid w-full max-w-3xl gap-6">
			<Link
				href="/dashboard/clients"
				className="flex w-fit items-center gap-1 text-sm hover:underline"
			>
				<ArrowLeftIcon aria-hidden="true" className="size-4" />
				All clients
			</Link>
			<Suspense fallback={<ListSkeleton title label="Loading client…" />}>
				<Profile params={params} />
			</Suspense>
		</div>
	);
}

async function Profile({ params }: { params: PageProps<'/dashboard/clients/[id]'>['params'] }) {
	const ctx = await requireShopMember();
	const id = idSchema.safeParse((await params).id);
	if (!id.success) notFound();

	const shop = toBookingShop(ctx.shop);
	const db = await createClient();
	const profile = await loadClientProfile(db, shop, ctx, id.data, currentInstant());
	if (!profile) notFound();

	const isOwner = ctx.role === 'owner';
	const { stats } = profile;

	return (
		<>
			<div className="flex flex-wrap items-end justify-between gap-3">
				<div className="grid gap-1">
					<h1 className="text-2xl font-semibold">{profile.name}</h1>
					<p className="text-sm text-muted-foreground">
						Client since {profile.createdLabel}
						{profile.firstSource
							? ` · first came via ${SOURCE_LABELS[profile.firstSource] ?? profile.firstSource}`
							: null}
					</p>
				</div>
				{profile.anonymised ? null : (
					<Link
						href={bookAgainHref(profile.id, profile.bookAgain)}
						className={buttonVariants({ size: 'lg' })}
					>
						<CalendarPlusIcon aria-hidden="true" />
						Book again
					</Link>
				)}
			</div>

			{profile.anonymised ? (
				<p
					role="status"
					className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground"
				>
					This client&apos;s data was deleted. Their past bookings are kept without contact details.
				</p>
			) : null}

			<dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
				<Stat label="Visits" value={stats.visits} />
				<Stat label="No-shows" value={stats.noShows} />
				<Stat label="Cancellations" value={stats.cancellations} />
				<Stat
					label="Average spend"
					value={
						stats.avgSpendCents === null ? '–' : formatCents(stats.avgSpendCents, shop.currency)
					}
				/>
				<Stat
					label="Usual interval"
					value={stats.medianIntervalDays === null ? '–' : `${stats.medianIntervalDays} days`}
				/>
			</dl>

			{profile.anonymised ? null : (
				<div className="grid gap-6 md:grid-cols-2">
					<section className="grid content-start gap-3" aria-labelledby="contact-heading">
						<h2 id="contact-heading" className="font-medium">
							Contact details
						</h2>
						<ClientContactForm
							client={{
								id: profile.id,
								name: profile.name,
								phone: profile.phone,
								email: profile.email,
								totalBookings: stats.totalBookings,
							}}
							isOwner={isOwner}
						/>
						<dl className="grid gap-1 text-sm">
							<div className="flex justify-between gap-3">
								<dt className="text-muted-foreground">Marketing messages</dt>
								<dd>
									{profile.marketingOptIn
										? `Opted in${profile.marketingOptInLabel ? ` on ${profile.marketingOptInLabel}` : ''}`
										: 'Not opted in'}
								</dd>
							</div>
							<div className="flex justify-between gap-3">
								<dt className="text-muted-foreground">Text messages</dt>
								<dd>{profile.smsOptedOut ? 'Opted out (replied STOP)' : 'Receiving'}</dd>
							</div>
						</dl>
					</section>

					<section className="grid content-start gap-3" aria-labelledby="notes-heading">
						<h2 id="notes-heading" className="font-medium">
							Private notes
						</h2>
						<ClientNotes clientId={profile.id} notes={profile.notes} canAdd />
					</section>
				</div>
			)}

			<section className="grid gap-2" aria-labelledby="upcoming-heading">
				<h2 id="upcoming-heading" className="font-medium">
					Upcoming
				</h2>
				<BookingList bookings={profile.upcoming} showStaff showDate empty="No upcoming bookings." />
			</section>

			<section className="grid gap-2" aria-labelledby="history-heading">
				<h2 id="history-heading" className="font-medium">
					History
				</h2>
				<BookingList bookings={profile.past} showStaff showDate empty="No past bookings." />
				{profile.past.length === PAST_SHOWN ? (
					<p className="text-xs text-muted-foreground">Showing the latest {PAST_SHOWN}.</p>
				) : null}
			</section>

			{isOwner && !profile.anonymised ? (
				<section
					className="grid gap-2 rounded-lg border border-destructive/40 p-4"
					aria-labelledby="delete-heading"
				>
					<h2 id="delete-heading" className="font-medium">
						Delete client data
					</h2>
					<p className="text-sm text-muted-foreground">
						For when a client asks you to forget them. Bookings are kept anonymously.
					</p>
					<div>
						<DeleteClientButton clientId={profile.id} name={profile.name} />
					</div>
				</section>
			) : null}
		</>
	);
}

function Stat({ label, value }: { label: string; value: number | string }) {
	return (
		<div className="grid gap-0.5 rounded-lg border p-3">
			<dt className="text-sm text-muted-foreground">{label}</dt>
			<dd className="text-xl font-semibold tabular-nums">{value}</dd>
		</div>
	);
}
