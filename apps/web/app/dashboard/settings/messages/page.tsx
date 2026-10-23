import type { Metadata } from 'next';
import { Suspense } from 'react';
import { FormSkeleton } from '@/components/skeletons';
import { requireShopOwner } from '@/lib/auth/session';
import { MessageSettingsForm } from './messages-form';

export const metadata: Metadata = { title: 'Text messages' };

export default function MessageSettingsPage() {
	return (
		<div className="grid max-w-xl gap-4">
			<h1 className="text-2xl font-semibold">Text messages</h1>
			<Suspense fallback={<FormSkeleton />}>
				<MessageSettings />
			</Suspense>
		</div>
	);
}

async function MessageSettings() {
	const { shop } = await requireShopOwner();
	return (
		<MessageSettingsForm
			defaults={{
				confirmationEnabled: shop.sms_confirmation_enabled,
				reminderEnabled: shop.sms_reminder_enabled,
				confirmRequestEnabled: shop.sms_confirm_request_enabled,
				rescheduledEnabled: shop.sms_rescheduled_enabled,
				cancelledEnabled: shop.sms_cancelled_enabled,
				reminderLeadHours: shop.sms_reminder_lead_hours,
				signOff: shop.sms_sign_off ?? '',
			}}
		/>
	);
}
