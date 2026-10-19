'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import type { SettingsSection } from './sections';

export function SettingsNav({ items }: { items: SettingsSection[] }) {
	const pathname = usePathname();
	return (
		<nav aria-label="Settings" className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
			<ul className="flex gap-1 md:flex-col">
				{items.map((item) => {
					const active = pathname === item.href;
					return (
						<li key={item.href}>
							<Link
								href={item.href}
								aria-current={active ? 'page' : undefined}
								className={cn(
									'block rounded-md px-3 py-2 text-sm whitespace-nowrap hover:bg-muted',
									active && 'bg-muted font-medium',
								)}
							>
								{item.label}
							</Link>
						</li>
					);
				})}
			</ul>
		</nav>
	);
}
