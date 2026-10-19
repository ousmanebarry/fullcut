import type { Metadata } from 'next';
import { Suspense } from 'react';
import { requireShopOwner } from '@/lib/auth/session';
import { BookingRulesForm } from './booking-rules-form';

export const metadata: Metadata = { title: 'Booking rules · Fullcut' };

export default function BookingRulesPage() {
	return (
		<div className="grid max-w-xl gap-4">
			<h1 className="text-2xl font-semibold">Booking rules</h1>
			<Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
				<BookingRules />
			</Suspense>
		</div>
	);
}

async function BookingRules() {
	const { shop } = await requireShopOwner();
	return (
		<BookingRulesForm
			defaults={{
				slotStepMinutes: shop.slot_step_minutes,
				minLeadMinutes: shop.min_lead_minutes,
				maxHorizonDays: shop.max_horizon_days,
				bookingPageEnabled: shop.booking_page_enabled,
			}}
		/>
	);
}
