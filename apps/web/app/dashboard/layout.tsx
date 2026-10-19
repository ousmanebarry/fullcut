import Link from 'next/link';
import { Suspense } from 'react';
import { signOut } from '@/app/(auth)/actions';
import { Button } from '@/components/ui/button';
import { Toaster } from '@/components/ui/sonner';
import { requireShopMember } from '@/lib/auth/session';

export default function DashboardLayout({ children }: LayoutProps<'/dashboard'>) {
	return (
		<div className="flex flex-1 flex-col">
			<header className="border-b">
				<div className="mx-auto flex w-full max-w-5xl items-center gap-3 px-4 py-3">
					<Link href="/dashboard" className="font-semibold tracking-tight">
						Fullcut
					</Link>
					<Suspense fallback={null}>
						<ShopName />
					</Suspense>
					<nav aria-label="Main" className="ml-auto flex items-center gap-1">
						<Link
							href="/dashboard/settings"
							className="rounded-md px-2 py-1.5 text-sm hover:bg-muted"
						>
							Settings
						</Link>
						<form action={signOut}>
							<Button type="submit" variant="ghost">
								Sign out
							</Button>
						</form>
					</nav>
				</div>
			</header>
			<main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children}</main>
			<Toaster position="top-center" />
		</div>
	);
}

async function ShopName() {
	const { shop } = await requireShopMember();
	return <span className="truncate text-sm text-muted-foreground">{shop.name}</span>;
}
