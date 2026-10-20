import type { Metadata } from 'next';
import { Suspense } from 'react';
import { requireShopOwner } from '@/lib/auth/session';
import { getStripeSecretKey } from '@/lib/env';
import { centsToDollarInput } from '@/lib/money';
import {
	describeCancellationPolicy,
	type DepositMode,
	type DepositType,
} from '@/lib/payments/policy';
import { createClient } from '@/lib/supabase/server';
import { ConnectStripeButton, PaymentSettingsForm } from './payments-form';

export const metadata: Metadata = { title: 'Payments · Fullcut' };

export default function PaymentsSettingsPage() {
	return (
		<div className="grid max-w-xl gap-6">
			<div className="grid gap-1">
				<h1 className="text-2xl font-semibold">Payments</h1>
				<p className="text-sm text-muted-foreground">
					Take a deposit when clients book online. Money goes straight to your own Stripe account.
					Fullcut takes no fee; Stripe&apos;s card processing fee comes out of each deposit.
				</p>
			</div>
			<Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
				<Payments />
			</Suspense>
		</div>
	);
}

async function Payments() {
	const { shop } = await requireShopOwner();
	const db = await createClient();
	const { data: isDemo } = await db.rpc('is_demo_shop', { p_shop_id: shop.id });
	const configured = getStripeSecretKey() !== null;
	const policy = {
		freeCancelHours: shop.free_cancel_hours,
		lateCancelKeepsDeposit: shop.late_cancel_keeps_deposit,
		noShowKeepsDeposit: shop.no_show_keeps_deposit,
	};

	return (
		<>
			<section aria-labelledby="stripe-heading" className="grid gap-3 rounded-lg border p-4">
				<h2 id="stripe-heading" className="font-medium">
					Stripe
				</h2>
				{isDemo ? (
					<p className="text-sm text-muted-foreground">The demo shop can&apos;t take payments.</p>
				) : !configured ? (
					<p className="text-sm text-muted-foreground">Payments aren&apos;t available here yet.</p>
				) : shop.stripe_charges_enabled ? (
					<>
						<p className="text-sm">
							<span className="font-medium">Ready.</span> Stripe can take deposits for your shop.
						</p>
						<ConnectStripeButton label="Update details in Stripe" />
					</>
				) : shop.stripe_account_id ? (
					<>
						<p className="text-sm">
							<span className="font-medium">Finish payment setup.</span> Stripe needs a few more
							details before you can take deposits.
						</p>
						<ConnectStripeButton label="Continue in Stripe" />
					</>
				) : (
					<>
						<p className="text-sm text-muted-foreground">
							Connect a Stripe account to take deposits. You&apos;ll set it up on Stripe&apos;s site
							and come back here.
						</p>
						<ConnectStripeButton label="Connect Stripe" />
					</>
				)}
			</section>

			<section aria-labelledby="deposits-heading" className="grid gap-3">
				<h2 id="deposits-heading" className="font-medium">
					Deposits and cancellations
				</h2>
				<PaymentSettingsForm
					currency={shop.currency}
					chargesEnabled={shop.stripe_charges_enabled}
					defaults={{
						depositMode: shop.deposit_mode as DepositMode,
						depositType: shop.deposit_default_type as DepositType,
						depositAmount: shop.deposit_default_cents
							? centsToDollarInput(shop.deposit_default_cents)
							: '',
						depositPercent: shop.deposit_default_percent
							? String(shop.deposit_default_percent)
							: '',
						freeCancelHours: String(shop.free_cancel_hours),
						lateCancelKeepsDeposit: shop.late_cancel_keeps_deposit,
						noShowKeepsDeposit: shop.no_show_keeps_deposit,
					}}
				/>
				<div className="grid gap-1 rounded-lg bg-muted/40 p-3 text-sm">
					<p className="font-medium">Clients see (for a $20 deposit):</p>
					{describeCancellationPolicy(policy, 2000, shop.currency).map((line) => (
						<p key={line}>{line}</p>
					))}
				</div>
			</section>
		</>
	);
}
