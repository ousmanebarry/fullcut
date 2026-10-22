'use client';

import {
	CalendarDaysIcon,
	ClipboardCheckIcon,
	HourglassIcon,
	InboxIcon,
	LogOutIcon,
	MenuIcon,
	SettingsIcon,
	SunIcon,
	UsersIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Suspense, useState } from 'react';
import { signOut } from '@/app/(auth)/actions';
import { Logo } from '@/components/brand/logo';
import { ThemeToggle } from '@/components/theme/theme-toggle';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

type NavItem = { href: string; label: string; icon: typeof SunIcon };

const TODAY: NavItem = { href: '/dashboard', label: 'Today', icon: SunIcon };
const CALENDAR: NavItem = {
	href: '/dashboard/calendar',
	label: 'Calendar',
	icon: CalendarDaysIcon,
};
const CLIENTS: NavItem = { href: '/dashboard/clients', label: 'Clients', icon: UsersIcon };
const WAITLIST: NavItem = { href: '/dashboard/waitlist', label: 'Waitlist', icon: HourglassIcon };
const INBOX: NavItem = { href: '/dashboard/inbox', label: 'Inbox', icon: InboxIcon };
const OUTCOMES: NavItem = {
	href: '/dashboard/outcomes',
	label: 'Outcomes',
	icon: ClipboardCheckIcon,
};
const SETTINGS: NavItem = { href: '/dashboard/settings', label: 'Settings', icon: SettingsIcon };

const DESKTOP_NAV = [TODAY, CALENDAR, CLIENTS, WAITLIST, INBOX, SETTINGS];
const TAB_BAR = [TODAY, CALENDAR, CLIENTS, WAITLIST];
const MORE = [INBOX, OUTCOMES, SETTINGS];

export function isActive(pathname: string, href: string): boolean {
	if (href === '/dashboard') return pathname === href;
	return pathname === href || pathname.startsWith(`${href}/`);
}

export function DashboardHeader({ shopName }: { shopName: React.ReactNode }) {
	return (
		<header className="sticky top-0 z-30 border-b bg-background/90 pt-safe backdrop-blur supports-backdrop-filter:bg-background/75">
			<div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-3 px-4">
				<Logo href="/dashboard" className="shrink-0" />
				<span className="hidden h-5 w-px bg-border sm:block" aria-hidden />
				<div className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{shopName}</div>
				{/* The static shell renders the nav without an active item; the pathname streams in. */}
				<Suspense fallback={<DesktopNav pathname="" />}>
					<CurrentDesktopNav />
				</Suspense>
				<ThemeToggle />
				<form action={signOut} className="hidden md:block">
					<Button type="submit" variant="ghost">
						Sign out
					</Button>
				</form>
			</div>
		</header>
	);
}

function CurrentDesktopNav() {
	return <DesktopNav pathname={usePathname()} />;
}

function DesktopNav({ pathname }: { pathname: string }) {
	return (
		<nav aria-label="Main" className="hidden items-center gap-0.5 md:flex">
			{DESKTOP_NAV.map((item) => {
				const active = isActive(pathname, item.href);
				return (
					<Link
						key={item.href}
						href={item.href}
						aria-current={active ? 'page' : undefined}
						className={cn(
							'rounded-md px-2.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
							active && 'bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary',
						)}
					>
						{item.label}
					</Link>
				);
			})}
		</nav>
	);
}

export function BottomTabBar() {
	return (
		<Suspense fallback={<TabBar pathname="" />}>
			<CurrentTabBar />
		</Suspense>
	);
}

function CurrentTabBar() {
	return <TabBar pathname={usePathname()} />;
}

function TabBar({ pathname }: { pathname: string }) {
	const [moreOpen, setMoreOpen] = useState(false);
	const moreActive = MORE.some((item) => isActive(pathname, item.href));
	return (
		<>
			<nav
				aria-label="Main"
				className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-safe backdrop-blur supports-backdrop-filter:bg-background/80 md:hidden"
			>
				<ul className="mx-auto grid h-16 max-w-lg grid-cols-5">
					{TAB_BAR.map((item) => (
						<li key={item.href}>
							<TabLink item={item} active={isActive(pathname, item.href)} />
						</li>
					))}
					<li>
						<button
							type="button"
							aria-haspopup="dialog"
							aria-expanded={moreOpen}
							onClick={() => setMoreOpen(true)}
							className={tabClass(moreActive)}
						>
							<MenuIcon aria-hidden className="size-5" />
							More
						</button>
					</li>
				</ul>
			</nav>
			<Sheet open={moreOpen} onOpenChange={setMoreOpen}>
				<SheetContent side="bottom" className="rounded-t-2xl pb-safe">
					<SheetHeader>
						<SheetTitle>More</SheetTitle>
					</SheetHeader>
					<ul className="grid gap-1 px-2">
						{MORE.map((item) => {
							const active = isActive(pathname, item.href);
							return (
								<li key={item.href}>
									<Link
										href={item.href}
										aria-current={active ? 'page' : undefined}
										onClick={() => setMoreOpen(false)}
										className={cn(
											'flex min-h-12 items-center gap-3 rounded-lg px-3 text-base font-medium hover:bg-accent',
											active && 'bg-primary/10 text-primary',
										)}
									>
										<item.icon aria-hidden className="size-5" />
										{item.label}
									</Link>
								</li>
							);
						})}
					</ul>
					<form action={signOut} className="border-t px-2 pt-2 pb-4">
						<button
							type="submit"
							className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-base font-medium hover:bg-accent"
						>
							<LogOutIcon aria-hidden className="size-5" />
							Sign out
						</button>
					</form>
				</SheetContent>
			</Sheet>
		</>
	);
}

function tabClass(active: boolean) {
	return cn(
		'flex h-full w-full flex-col items-center justify-center gap-1 text-[0.7rem] font-medium text-muted-foreground outline-none focus-visible:bg-accent',
		active && 'text-primary',
	);
}

function TabLink({ item, active }: { item: NavItem; active: boolean }) {
	return (
		<Link href={item.href} aria-current={active ? 'page' : undefined} className={tabClass(active)}>
			<item.icon aria-hidden className={cn('size-5', active && 'stroke-[2.5]')} />
			{item.label}
		</Link>
	);
}
