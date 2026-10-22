import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { ListSkeleton } from '@/components/skeletons';
import { ManageWaitlist } from '@/components/booking/manage-waitlist';
import { createAdminClient } from '@/lib/supabase/admin';
import { formatShortDate, localDate, timeZone, zonedToInstant, type Instant } from '@/lib/time';
import { findEntryByToken } from '@/lib/waitlist/manage';

export const metadata: Metadata = {
	title: 'Your waitlist spot',
	robots: { index: false, follow: false },
};

export default function WaitlistPage({ params }: PageProps<'/wl/[token]'>) {
	return (
		<main className="mx-auto grid w-full max-w-lg gap-6 px-4 py-6">
			<Suspense fallback={<ListSkeleton rows={3} title />}>
				<Entry params={params} />
			</Suspense>
		</main>
	);
}

async function loadEntry(token: string) {
	await connection();
	return findEntryByToken(createAdminClient(), token, Date.now() as Instant);
}

async function Entry({ params }: Pick<PageProps<'/wl/[token]'>, 'params'>) {
	const { token } = await params;
	const entry = await loadEntry(token);

	if (!entry) {
		return (
			<div className="grid gap-2 text-center">
				<h1 className="text-2xl font-semibold">This link isn&apos;t valid</h1>
				<p className="text-sm text-muted-foreground">
					It may have expired or been mistyped. Contact the shop if you need help.
				</p>
			</div>
		);
	}

	return (
		<ManageWaitlist
			token={token}
			status={entry.status}
			shop={entry.shop}
			serviceName={entry.serviceName}
			staffName={entry.staffName}
			earliestLabel={dateLabel(entry.earliestDate, entry.shop.timezone)}
			latestLabel={dateLabel(entry.latestDate, entry.shop.timezone)}
			timeWindows={entry.timeWindows}
		/>
	);
}

// Noon avoids DST edge cases when formatting a plain date.
function dateLabel(date: string, zone: string): string {
	const tz = timeZone(zone);
	return formatShortDate(zonedToInstant(localDate(date), 12 * 60, tz), tz);
}
