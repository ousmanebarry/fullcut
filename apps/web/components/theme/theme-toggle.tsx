'use client';

import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import {
	getThemePreference,
	setThemePreference,
	subscribeTheme,
	type ThemePreference,
} from '@/lib/theme';

const NEXT: Record<ThemePreference, ThemePreference> = {
	system: 'light',
	light: 'dark',
	dark: 'system',
};
const LABEL: Record<ThemePreference, string> = {
	system: 'System',
	light: 'Light',
	dark: 'Dark',
};
const ICON = { system: MonitorIcon, light: SunIcon, dark: MoonIcon };

export function ThemeToggle() {
	const preference = useSyncExternalStore(
		subscribeTheme,
		getThemePreference,
		(): ThemePreference => 'system',
	);
	const next = NEXT[preference];
	const Icon = ICON[preference];
	const label = `Theme: ${LABEL[preference]}. Switch to ${LABEL[next].toLowerCase()}`;
	return (
		<Button
			type="button"
			variant="ghost"
			size="icon-lg"
			aria-label={label}
			title={label}
			onClick={() => setThemePreference(next)}
		>
			<Icon aria-hidden="true" />
		</Button>
	);
}
