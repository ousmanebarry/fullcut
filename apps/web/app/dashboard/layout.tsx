import { Suspense } from 'react';
import { BottomTabBar, DashboardHeader } from '@/components/dashboard/app-nav';
import { BookingsLive } from '@/components/dashboard/bookings-live';
import { DemoTour, RestartTourButton } from '@/components/demo/demo-tour';
import { InstallHint } from '@/components/pwa/install-hint';
import { ServiceWorkerRegister } from '@/components/pwa/service-worker-register';
import { Toaster } from '@/components/ui/sonner';
import { requireShopMember } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';

export default function DashboardLayout({ children }: LayoutProps<'/dashboard'>) {
	return (
		// --tab-bar-h lifts sticky action bars above the phone tab bar, which already covers the home indicator.
		<div className="flex flex-1 flex-col [--bar-safe:0px] [--tab-bar-h:calc(4rem+env(safe-area-inset-bottom))] md:[--tab-bar-h:0px]">
			<DashboardHeader
				shopName={
					<Suspense fallback={null}>
						<ShopName />
					</Suspense>
				}
			/>
			<main className="mx-auto w-full max-w-7xl flex-1 px-4 pt-5 pb-[calc(var(--tab-bar-h)+5.5rem)] md:py-8">
				<Suspense fallback={null}>
					<DemoNotice />
				</Suspense>
				<InstallHint />
				{children}
			</main>
			<BottomTabBar />
			<Toaster position="top-center" />
			<ServiceWorkerRegister />
			<Suspense fallback={null}>
				<LiveUpdates />
			</Suspense>
		</div>
	);
}

async function ShopName() {
	const { shop } = await requireShopMember();
	return <span className="truncate">{shop.name}</span>;
}

async function LiveUpdates() {
	const { shop } = await requireShopMember();
	return <BookingsLive shopId={shop.id} />;
}

async function DemoNotice() {
	const { shop } = await requireShopMember();
	const db = await createClient();
	const { data: isDemo } = await db.rpc('is_demo_shop', { p_shop_id: shop.id });
	if (!isDemo) return null;
	return (
		<>
			<p className="mb-4 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
				You&apos;re exploring a demo shop with made-up clients. Change anything you like: it resets
				every night at 08:00 UTC. <RestartTourButton />
			</p>
			<DemoTour />
		</>
	);
}
