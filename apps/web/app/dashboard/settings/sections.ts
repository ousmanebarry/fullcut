import type { ShopRole } from '@/lib/auth/roles';

export interface SettingsSection {
	href: string;
	label: string;
	description: string;
}

const SECTIONS: (SettingsSection & { ownerOnly: boolean })[] = [
	{
		href: '/dashboard/settings/shop',
		label: 'Shop',
		description: 'Name, link, timezone and contact details',
		ownerOnly: true,
	},
	{
		href: '/dashboard/settings/staff',
		label: 'Staff',
		description: 'Who takes bookings',
		ownerOnly: true,
	},
	{
		href: '/dashboard/settings/services',
		label: 'Services',
		description: 'What clients can book, and prices',
		ownerOnly: true,
	},
	{
		href: '/dashboard/settings/hours',
		label: 'Hours',
		description: 'Weekly working hours',
		ownerOnly: false,
	},
	{
		href: '/dashboard/settings/time-off',
		label: 'Time off',
		description: 'Holidays and days away',
		ownerOnly: false,
	},
	{
		href: '/dashboard/settings/booking-rules',
		label: 'Booking rules',
		description: 'Slot length, notice and how far ahead',
		ownerOnly: true,
	},
	{
		href: '/dashboard/settings/messages',
		label: 'Text messages',
		description: 'Confirmations, reminders and your sign-off',
		ownerOnly: true,
	},
	{
		href: '/dashboard/settings/export',
		label: 'Export data',
		description: 'Download all your shop data as spreadsheets',
		ownerOnly: true,
	},
];

export function settingsSections(role: ShopRole): SettingsSection[] {
	return SECTIONS.filter((section) => role === 'owner' || !section.ownerOnly).map(
		({ href, label, description }) => ({ href, label, description }),
	);
}
