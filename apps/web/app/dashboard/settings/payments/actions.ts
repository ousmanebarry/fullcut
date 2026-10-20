'use server';

import { redirect } from 'next/navigation';
import { getSessionUser, requireShopOwner } from '@/lib/auth/session';
import { getSiteUrl } from '@/lib/env';
import {
	checkboxField,
	failure,
	fieldErrorsFrom,
	formValues,
	textField,
	type FormState,
} from '@/lib/forms';
import { getPaymentGateway } from '@/lib/payments/gateway';
import {
	onboardingRedirects,
	onboardingUrl,
	paymentSettingsSchema,
	updatePaymentSettings,
} from '@/lib/payments/settings';
import { createAdminClient } from '@/lib/supabase/admin';
import { settingsActionContext, toFormState } from '../_lib/action';

export async function savePaymentSettings(
	_prev: FormState,
	formData: FormData,
): Promise<FormState> {
	const { actor, db } = await settingsActionContext();
	const values = formValues(formData);
	const parsed = paymentSettingsSchema.safeParse({
		depositMode: textField(formData, 'depositMode'),
		depositType: textField(formData, 'depositType'),
		depositAmount: textField(formData, 'depositAmount'),
		depositPercent: textField(formData, 'depositPercent'),
		freeCancelHours: textField(formData, 'freeCancelHours'),
		lateCancelKeepsDeposit: checkboxField(formData, 'lateCancelKeepsDeposit'),
		noShowKeepsDeposit: checkboxField(formData, 'noShowKeepsDeposit'),
	});
	if (!parsed.success)
		return failure('Check the highlighted fields.', fieldErrorsFrom(parsed.error), values);

	return toFormState(
		await updatePaymentSettings(db, actor, parsed.data),
		'Payment settings saved.',
		values,
	);
}

const CONNECT_ERRORS = {
	demo_shop: "The demo shop can't connect Stripe.",
	not_configured: "Payments aren't available here yet.",
} as const;

export async function connectStripe(): Promise<FormState> {
	const { shop } = await requireShopOwner();
	const user = await getSessionUser();
	let url: string;
	try {
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
		if (!result.ok) return failure(CONNECT_ERRORS[result.error]);
		url = result.url;
	} catch (error) {
		console.error('Stripe onboarding failed', error);
		return failure("Couldn't reach Stripe. Try again in a moment.");
	}
	redirect(url);
}
