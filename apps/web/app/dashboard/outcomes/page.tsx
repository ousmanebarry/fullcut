import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { ListSkeleton } from '@/components/skeletons';
import { UnmarkedList } from '@/components/dashboard/unmarked-list';
import { requireShopMember } from '@/lib/auth/session';
import { loadUnmarked } from '@/lib/dashboard/queries';
import { currentInstant } from '@/lib/dashboard/views';
import { toBookingShop } from '@/lib/public-booking/data';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Outcomes' };

export default function OutcomesPage() {
	return (
		<div className="mx-auto grid w-full max-w-3xl gap-4">
			<div className="grid gap-1">
				<Link href="/dashboard" className="text-sm text-muted-foreground hover:underline">
					← Today
				</Link>
				<h1 className="text-2xl font-semibold">Needs an outcome</h1>
				<p className="text-sm text-muted-foreground">
					Did they show up? Marking every appointment keeps your no-show history accurate.
				</p>
			</div>
			<Suspense fallback={<ListSkeleton />}>
				<Unmarked />
			</Suspense>
		</div>
	);
}

async function Unmarked() {
	const ctx = await requireShopMember();
	const db = await createClient();
	const ownStaffId = ctx.role === 'staff' ? ctx.staffId : null;
	const { bookings, total } = await loadUnmarked(
		db,
		toBookingShop(ctx.shop),
		currentInstant(),
		ownStaffId,
	);
	return (
		<>
			{total > bookings.length ? (
				<p className="text-sm text-muted-foreground">
					Showing the oldest {bookings.length} of {total}.
				</p>
			) : null}
			<UnmarkedList bookings={bookings} showStaff={ownStaffId === null} />
		</>
	);
}
