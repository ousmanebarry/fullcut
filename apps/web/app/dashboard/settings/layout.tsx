import { Suspense } from 'react';
import { requireShopMember } from '@/lib/auth/session';
import { SettingsNav } from './settings-nav';
import { settingsSections } from './sections';

export default function SettingsLayout({ children }: LayoutProps<'/dashboard/settings'>) {
	return (
		<div className="grid gap-6 md:grid-cols-[12rem_1fr]">
			<Suspense fallback={<div className="h-10" />}>
				<RoleAwareNav />
			</Suspense>
			<div className="min-w-0">{children}</div>
		</div>
	);
}

async function RoleAwareNav() {
	const { role } = await requireShopMember();
	return <SettingsNav items={settingsSections(role)} />;
}
