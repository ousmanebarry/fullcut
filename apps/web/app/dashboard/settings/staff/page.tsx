import type { Metadata } from 'next';
import { Suspense } from 'react';
import { requireShopOwner } from '@/lib/auth/session';
import { listStaff } from '@/lib/shop/queries';
import { AddStaffForm, StaffRow } from './staff-forms';

export const metadata: Metadata = { title: 'Staff · Fullcut' };

export default function StaffSettingsPage() {
	return (
		<div className="grid max-w-2xl gap-4">
			<div className="grid gap-1">
				<h1 className="text-2xl font-semibold">Staff</h1>
				<p className="text-sm text-muted-foreground">
					Deactivated staff stop taking new bookings; their past bookings are kept.
				</p>
			</div>
			<Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
				<StaffList />
			</Suspense>
		</div>
	);
}

async function StaffList() {
	const ctx = await requireShopOwner();
	const staff = await listStaff(ctx);

	return (
		<>
			<AddStaffForm />
			{staff.length === 0 ? (
				<p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
					Add your first staff member to start taking bookings.
				</p>
			) : (
				<ul className="grid gap-3">
					{staff.map((member) => (
						<StaffRow key={member.id} staff={member} />
					))}
				</ul>
			)}
		</>
	);
}
