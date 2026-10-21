import type { Metadata } from 'next';
import { Suspense } from 'react';
import { requireShopOwner } from '@/lib/auth/session';
import { loadTierShares } from '@/lib/risk/queries';
import { toRiskSettings } from '@/lib/risk/settings';
import { createClient } from '@/lib/supabase/server';
import type { Instant } from '@/lib/time';
import { RiskSettingsForm } from './no-shows-form';

export const metadata: Metadata = { title: 'No-show protection · Fullcut' };

export default function NoShowSettingsPage() {
	return (
		<div className="grid max-w-xl gap-4">
			<h1 className="text-2xl font-semibold">No-show protection</h1>
			<Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
				<NoShowSettings />
			</Suspense>
		</div>
	);
}

function now(): Instant {
	return Date.now() as Instant;
}

async function NoShowSettings() {
	const { shop } = await requireShopOwner();
	const shares = await loadTierShares(await createClient(), shop.id, now());
	return <RiskSettingsForm defaults={toRiskSettings(shop)} shares={shares} />;
}
