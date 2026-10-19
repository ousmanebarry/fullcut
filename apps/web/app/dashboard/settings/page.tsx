import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { requireShopMember } from '@/lib/auth/session';
import { settingsSections } from './sections';

export const metadata: Metadata = { title: 'Settings · Fullcut' };

export default function SettingsPage() {
	return (
		<div className="grid gap-4">
			<h1 className="text-2xl font-semibold">Settings</h1>
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
					<Link href={section.href} className="block rounded-xl border p-4 hover:bg-muted">
						<span className="block font-medium">{section.label}</span>
						<span className="block text-sm text-muted-foreground">{section.description}</span>
					</Link>
				</li>
			))}
		</ul>
	);
}
