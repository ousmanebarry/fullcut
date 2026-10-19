import type { Metadata } from 'next';
import { Suspense } from 'react';
import { requireShopOwner } from '@/lib/auth/session';
import { timeZoneOptions } from '@/lib/shop/timezones';
import { ShopProfileForm } from './shop-form';

export const metadata: Metadata = { title: 'Shop settings · Fullcut' };

export default function ShopSettingsPage() {
	return (
		<div className="grid max-w-xl gap-4">
			<h1 className="text-2xl font-semibold">Shop</h1>
			<Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
				<ShopSettings />
			</Suspense>
		</div>
	);
}

async function ShopSettings() {
	const { shop } = await requireShopOwner();
	return (
		<ShopProfileForm
			timeZones={timeZoneOptions(shop.timezone)}
			defaults={{
				name: shop.name,
				slug: shop.slug,
				timezone: shop.timezone,
				currency: shop.currency,
				phone: shop.phone ?? '',
				address: shop.address ?? '',
				aboutText: shop.about_text ?? '',
				logoUrl: shop.logo_url ?? '',
			}}
		/>
	);
}
