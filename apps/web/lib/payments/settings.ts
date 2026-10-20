import { z } from 'zod';
import { isOwner } from '@/lib/auth/roles';
import { toUserFacingError } from '@/lib/db/errors';
import { countryForCurrency } from '@/lib/contact/phone';
import { dollarsToCentsSchema } from '@/lib/money';
import { OWNER_ONLY, type Actor, type Db, type MutationResult } from '@/lib/shop/settings';
import type { PaymentGateway } from './gateway';
import { DEPOSIT_MODES, MIN_DEPOSIT_CENTS } from './policy';

const wholeNumber = (min: number, max: number, message: string) =>
	z.coerce
		.number({ error: message })
		.int({ error: message })
		.min(min, { error: message })
		.max(max, {
			error: message,
		});

export const paymentSettingsSchema = z
	.object({
		depositMode: z.enum(DEPOSIT_MODES, { error: 'Choose when to take a deposit.' }),
		depositType: z.enum(['fixed', 'percent'], { error: 'Choose an amount or a percentage.' }),
		depositAmount: z
			.string()
			.trim()
			.transform((value) => value || '0')
			.pipe(dollarsToCentsSchema),
		// A blank field coerces to 0.
		depositPercent: wholeNumber(0, 100, 'Enter a percentage from 0 to 100.'),
		freeCancelHours: wholeNumber(0, 168, 'Choose between 0 and 168 hours.'),
		lateCancelKeepsDeposit: z.boolean(),
		noShowKeepsDeposit: z.boolean(),
	})
	.superRefine((input, ctx) => {
		if (input.depositMode !== 'all_bookings') return;
		if (input.depositType === 'fixed' && input.depositAmount < MIN_DEPOSIT_CENTS) {
			ctx.addIssue({
				code: 'custom',
				path: ['depositAmount'],
				message: 'Enter a deposit of at least $0.50.',
			});
		}
		if (input.depositType === 'percent' && input.depositPercent < 1) {
			ctx.addIssue({
				code: 'custom',
				path: ['depositPercent'],
				message: 'Enter a percentage from 1 to 100.',
			});
		}
	});

export type PaymentSettingsInput = z.output<typeof paymentSettingsSchema>;

const NOT_READY = {
	field: 'depositMode',
	message: 'Finish setting up Stripe before turning on deposits.',
};

/** Owner-only. Deposits can be turned on only once Stripe can take charges for the shop. */
export async function updatePaymentSettings(
	db: Db,
	actor: Actor,
	input: PaymentSettingsInput,
): Promise<MutationResult> {
	if (!isOwner(actor)) return { ok: false, error: OWNER_ONLY };
	if (input.depositMode !== 'off') {
		const { data: shop, error } = await db
			.from('shops')
			.select('stripe_charges_enabled')
			.eq('id', actor.shopId)
			.single();
		if (error) return { ok: false, error: toUserFacingError(error) };
		if (!shop.stripe_charges_enabled) return { ok: false, error: NOT_READY };
	}
	const { data, error } = await db
		.from('shops')
		.update({
			deposit_mode: input.depositMode,
			deposit_default_type: input.depositType,
			deposit_default_cents: input.depositAmount,
			deposit_default_percent: input.depositPercent,
			free_cancel_hours: input.freeCancelHours,
			late_cancel_keeps_deposit: input.lateCancelKeepsDeposit,
			no_show_keeps_deposit: input.noShowKeepsDeposit,
		})
		.eq('id', actor.shopId)
		.select('id');
	if (error) return { ok: false, error: toUserFacingError(error) };
	return data.length > 0 ? { ok: true, value: null } : { ok: false, error: OWNER_ONLY };
}

export interface ConnectShop {
	id: string;
	name: string;
	currency: string;
	stripeAccountId: string | null;
}

export type ConnectError = 'demo_shop' | 'not_configured';

/** Where Stripe sends the owner after onboarding, and when a link has expired. */
export function onboardingRedirects(siteUrl: string) {
	return {
		returnUrl: new URL('/dashboard/settings/payments/return', siteUrl).toString(),
		refreshUrl: new URL('/dashboard/settings/payments/refresh', siteUrl).toString(),
	};
}

/**
 * The Stripe-hosted onboarding URL for the shop, creating its connected account first if needed.
 * `admin` must be a service-role client: the Stripe columns are server-only. The shop comes from the
 * signed-in owner's session, never from the request.
 */
export async function onboardingUrl(
	admin: Db,
	gateway: PaymentGateway | null,
	shop: ConnectShop,
	ownerEmail: string | null,
	urls: { returnUrl: string; refreshUrl: string },
): Promise<{ ok: true; url: string } | { ok: false; error: ConnectError }> {
	if (!gateway) return { ok: false, error: 'not_configured' };
	const { data: demo, error: demoError } = await admin.rpc('is_demo_shop', { p_shop_id: shop.id });
	if (demoError) throw demoError;
	if (demo) return { ok: false, error: 'demo_shop' };

	let accountId = shop.stripeAccountId;
	if (!accountId) {
		accountId = await gateway.createAccount({
			shopId: shop.id,
			displayName: shop.name,
			email: ownerEmail,
			country: countryForCurrency(shop.currency),
			currency: shop.currency,
		});
		const { error } = await admin
			.from('shops')
			.update({ stripe_account_id: accountId })
			.eq('id', shop.id)
			.is('stripe_account_id', null);
		if (error) throw error;
	}
	return { ok: true, url: await gateway.onboardingUrl(accountId, urls.returnUrl, urls.refreshUrl) };
}
