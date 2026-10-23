import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { Logo } from '@/components/brand/logo';
import { FormSkeleton } from '@/components/skeletons';
import { getCurrentShop, requireUser } from '@/lib/auth/session';
import { timeZoneOptions } from '@/lib/shop/timezones';
import { OnboardingWizard } from './wizard';

export const metadata: Metadata = { title: 'Set up your shop' };

export default function OnboardingPage() {
	return (
		<main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 pt-[calc(2rem+env(safe-area-inset-top))] pb-8 md:my-10 md:flex-none md:rounded-2xl md:border md:bg-card md:p-8 md:shadow-sm">
			<div className="grid gap-4">
				<Logo />
				<h1 className="text-2xl font-semibold tracking-tight">Set up your shop</h1>
			</div>
			<Suspense fallback={<FormSkeleton />}>
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
