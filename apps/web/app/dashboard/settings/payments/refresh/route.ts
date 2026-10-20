import { redirect } from 'next/navigation';
import { getSessionUser, requireShopOwner } from '@/lib/auth/session';
import { getSiteUrl } from '@/lib/env';
import { getPaymentGateway } from '@/lib/payments/gateway';
import { onboardingRedirects, onboardingUrl } from '@/lib/payments/settings';
import { createAdminClient } from '@/lib/supabase/admin';

// Stripe sends the owner here when an onboarding link has expired or was already used: issue a fresh one.
export async function GET() {
	const { shop } = await requireShopOwner();
	if (!shop.stripe_account_id) redirect('/dashboard/settings/payments');
	const user = await getSessionUser();
	const result = await onboardingUrl(
		createAdminClient(),
		getPaymentGateway(),
		{
			id: shop.id,
			name: shop.name,
			currency: shop.currency,
			stripeAccountId: shop.stripe_account_id,
		},
		user?.email ?? null,
		onboardingRedirects(getSiteUrl()),
	);
	redirect(result.ok ? result.url : '/dashboard/settings/payments');
}
