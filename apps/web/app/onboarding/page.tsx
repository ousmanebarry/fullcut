import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { getCurrentShop, requireUser } from '@/lib/auth/session';
import { timeZoneOptions } from '@/lib/shop/timezones';
import { OnboardingWizard } from './wizard';

export const metadata: Metadata = { title: 'Set up your shop · Fullcut' };

export default function OnboardingPage() {
	return (
		<main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-8">
			<div className="grid gap-1">
				<p className="text-sm font-semibold tracking-tight">Fullcut</p>
				<h1 className="text-2xl font-semibold">Set up your shop</h1>
			</div>
			<Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
				<OnboardingGate />
			</Suspense>
		</main>
	);
}

async function OnboardingGate() {
	const user = await requireUser();
	if (await getCurrentShop()) redirect('/dashboard');
	return <OnboardingWizard defaultStaffName={user.name ?? ''} timeZones={timeZoneOptions()} />;
}
