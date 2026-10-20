import { revalidateTag } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireShopOwner } from '@/lib/auth/session';
import { refreshAccountStatus } from '@/lib/payments/events';
import { getPaymentGateway } from '@/lib/payments/gateway';
import { publicShopTag } from '@/lib/public-booking/cached';
import { createAdminClient } from '@/lib/supabase/admin';

// Stripe sends the owner back here after onboarding; status is re-read rather than waiting for a webhook.
export async function GET() {
	const { shop } = await requireShopOwner();
	if (shop.stripe_account_id) {
		await refreshAccountStatus(createAdminClient(), getPaymentGateway(), shop.stripe_account_id);
		revalidateTag(publicShopTag.id(shop.id), { expire: 0 });
	}
	redirect('/dashboard/settings/payments');
}
