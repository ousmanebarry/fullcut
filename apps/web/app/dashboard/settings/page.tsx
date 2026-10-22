import { ChevronRightIcon } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { requireShopMember } from '@/lib/auth/session';
import { settingsSections } from './sections';

export const metadata: Metadata = { title: 'Settings' };

export default function SettingsPage() {
	return (
		<div className="grid gap-4">
			<PageHeader title="Settings" />
			<Suspense fallback={null}>
				<Sections />
			</Suspense>
		</div>
	);
}

async function Sections() {
	const { role } = await requireShopMember();
	return (
		<ul className="grid gap-2 sm:grid-cols-2">
			{settingsSections(role).map((section) => (
				<li key={section.href}>
					<Link
						href={section.href}
						className="flex items-center gap-3 rounded-xl border bg-card p-4 hover:bg-accent/50"
					>
						<span className="grid flex-1 gap-0.5">
							<span className="font-medium">{section.label}</span>
							<span className="text-sm text-muted-foreground">{section.description}</span>
						</span>
						<ChevronRightIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
					</Link>
				</li>
			))}
		</ul>
	);
}
