import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { ManageBooking } from '@/components/booking/manage-booking';
import { loadActiveStaff } from '@/lib/public-booking/data';
import {
	findBookingByToken,
	managedDetails,
	managePolicy,
	refundIfCancelledNow,
} from '@/lib/public-booking/manage';
import { createAdminClient } from '@/lib/supabase/admin';
import { formatLongDateTime, type Instant } from '@/lib/time';

export const metadata: Metadata = {
	title: 'Your booking · Fullcut',
	robots: { index: false, follow: false },
};

export default function ManageBookingPage({ params, searchParams }: PageProps<'/b/[token]'>) {
	return (
		<main className="mx-auto grid w-full max-w-lg gap-6 px-4 py-6">
			<Suspense fallback={<p className="text-sm text-muted-foreground">Loading your booking…</p>}>
				<ManagedBooking params={params} searchParams={searchParams} />
			</Suspense>
		</main>
	);
}

async function loadManagePage(token: string) {
	await connection();
	const now = Date.now() as Instant;
	const db = createAdminClient();
	const booking = await findBookingByToken(db, token, now);
	if (!booking) return null;
	const policy = managePolicy(booking, now);
	const staff = policy.canReschedule ? await loadActiveStaff(db, booking.shop.id) : [];
	return { booking, policy, staff, refundIfCancelled: refundIfCancelledNow(booking, now) };
}

async function ManagedBooking({
	params,
	searchParams,
}: Pick<PageProps<'/b/[token]'>, 'params' | 'searchParams'>) {
	const { token } = await params;
	const { checkout } = await searchParams;
	const page = await loadManagePage(token);

	if (!page) {
		return (
			<div className="grid gap-2 text-center">
				<h1 className="text-2xl font-semibold">This link isn&apos;t valid</h1>
				<p className="text-sm text-muted-foreground">
					It may have expired or been mistyped. Contact the shop to change your booking.
				</p>
			</div>
		);
	}

	const { booking, policy, staff, refundIfCancelled } = page;
	return (
		<ManageBooking
			token={token}
			reference={booking.reference}
			status={booking.status}
			booking={managedDetails(booking)}
			canCancel={policy.canCancel}
			canReschedule={policy.canReschedule}
			changeDeadline={formatLongDateTime(policy.changeDeadline, booking.shop.timezone)}
			shop={{
				slug: booking.shop.slug,
				name: booking.shop.name,
				phone: booking.shop.phone,
				timezone: booking.shop.timezone,
			}}
			serviceId={booking.service.id}
			staff={staff}
			staffId={booking.staffId}
			payment={booking.payment}
			refundIfCancelled={refundIfCancelled}
			holdUntil={
				booking.pendingExpiresAt
					? formatLongDateTime(booking.pendingExpiresAt, booking.shop.timezone)
					: null
			}
			checkoutReturn={checkout === 'success' || checkout === 'cancelled' ? checkout : null}
		/>
	);
}
