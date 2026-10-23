import type { Metadata } from 'next';
import { Suspense } from 'react';
import { FormSkeleton } from '@/components/skeletons';
import { requireShopOwner } from '@/lib/auth/session';
import { WaitlistSettingsForm } from './waitlist-form';

export const metadata: Metadata = { title: 'Waitlist' };

export default function WaitlistSettingsPage() {
	return (
		<div className="grid max-w-xl gap-4">
			<h1 className="text-2xl font-semibold">Waitlist</h1>
			<Suspense fallback={<FormSkeleton fields={3} />}>
				<WaitlistSettings />
			</Suspense>
		</div>
	);
}

async function WaitlistSettings() {
	const { shop } = await requireShopOwner();
	return (
		<WaitlistSettingsForm
			defaults={{
				enabled: shop.waitlist_enabled,
				waveSize: shop.waitlist_wave_size,
				offerMinutes: shop.waitlist_offer_minutes,
				minNoticeMinutes: shop.waitlist_min_notice_minutes,
			}}
		/>
	);
}
