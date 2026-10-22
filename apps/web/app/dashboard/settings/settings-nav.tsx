'use client';

import { ChevronLeftIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import type { SettingsSection } from './sections';

export function SettingsNav({ items }: { items: SettingsSection[] }) {
	const pathname = usePathname();
	const onIndex = pathname === '/dashboard/settings';
	return (
		<>
			{/* Phones navigate settings through the index list, so sub-pages only need a way back. */}
			{onIndex ? null : (
				<Link
					href="/dashboard/settings"
					className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:underline md:hidden"
				>
					<ChevronLeftIcon aria-hidden className="size-4" />
					Settings
				</Link>
			)}
			<nav aria-label="Settings" className="hidden md:block">
				<ul className="flex flex-col gap-1">
					{items.map((item) => {
						const active = pathname === item.href;
						return (
							<li key={item.href}>
								<Link
									href={item.href}
									aria-current={active ? 'page' : undefined}
									className={cn(
										'block rounded-md px-3 py-2 text-sm hover:bg-accent',
										active && 'bg-primary/10 font-medium text-primary hover:bg-primary/15',
									)}
								>
									{item.label}
								</Link>
							</li>
						);
					})}
				</ul>
			</nav>
		</>
	);
}
