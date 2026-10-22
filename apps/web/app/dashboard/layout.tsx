import Link from 'next/link';
import { Suspense } from 'react';
import { signOut } from '@/app/(auth)/actions';
import { BookingsLive } from '@/components/dashboard/bookings-live';
import { DemoTour, RestartTourButton } from '@/components/demo/demo-tour';
import { InstallHint } from '@/components/pwa/install-hint';
import { ServiceWorkerRegister } from '@/components/pwa/service-worker-register';
import { ThemeToggle } from '@/components/theme/theme-toggle';
import { Button } from '@/components/ui/button';
import { Toaster } from '@/components/ui/sonner';
import { requireShopMember } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';

const NAV = [
	{ href: '/dashboard', label: 'Today' },
	{ href: '/dashboard/calendar', label: 'Calendar' },
	{ href: '/dashboard/clients', label: 'Clients' },
	{ href: '/dashboard/waitlist', label: 'Waitlist' },
	{ href: '/dashboard/inbox', label: 'Inbox' },
	{ href: '/dashboard/settings', label: 'Settings' },
];

export default function DashboardLayout({ children }: LayoutProps<'/dashboard'>) {
	return (
		<div className="flex flex-1 flex-col">
			<header className="border-b">
				<div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
					<Link href="/dashboard" className="font-semibold tracking-tight">
						Fullcut
					</Link>
					<Suspense fallback={null}>
						<ShopName />
					</Suspense>
					<nav aria-label="Main" className="ml-auto flex flex-wrap items-center justify-end gap-1">
						{NAV.map((item) => (
							<Link
								key={item.href}
								href={item.href}
								className="rounded-md px-2 py-1.5 text-sm hover:bg-accent"
							>
								{item.label}
							</Link>
						))}
						<ThemeToggle />
						<form action={signOut}>
							<Button type="submit" variant="ghost">
								Sign out
							</Button>
						</form>
					</nav>
				</div>
			</header>
			<main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
				<Suspense fallback={null}>
					<DemoNotice />
				</Suspense>
				<InstallHint />
				{children}
			</main>
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
	return <span className="truncate text-sm text-muted-foreground">{shop.name}</span>;
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
