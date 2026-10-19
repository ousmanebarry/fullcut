import { describe, expect, it } from 'vitest';
import { safeRedirectPath } from '@/lib/auth/redirect';
import { canEditSchedule, isOwner, parseShopRole } from '@/lib/auth/roles';

describe('safeRedirectPath', () => {
	it.each([
		['/dashboard', '/dashboard'],
		['/dashboard/settings/services?tab=1#top', '/dashboard/settings/services?tab=1#top'],
		['/onboarding', '/onboarding'],
	])('keeps same-origin path %j', (input, expected) => {
		expect(safeRedirectPath(input)).toBe(expected);
	});

	it.each([
		null,
		undefined,
		42,
		'',
		'dashboard',
		'https://evil.example.com',
		'//evil.example.com',
		'/\\evil.example.com',
		'\\\\evil.example.com',
		'/\tevil',
		'javascript:alert(1)',
	])('rejects %j', (input) => {
		expect(safeRedirectPath(input)).toBeNull();
	});
});

describe('roles', () => {
	const owner = { role: 'owner' as const, staffId: 'staff-1' };
	const staff = { role: 'staff' as const, staffId: 'staff-2' };
	const unlinkedStaff = { role: 'staff' as const, staffId: null };

	it('parses known roles only', () => {
		expect(parseShopRole('owner')).toBe('owner');
		expect(parseShopRole('staff')).toBe('staff');
		expect(() => parseShopRole('admin')).toThrow();
	});

	it('only owners manage the shop', () => {
		expect(isOwner(owner)).toBe(true);
		expect(isOwner(staff)).toBe(false);
	});

	it('owners edit anyone’s schedule; staff only their own', () => {
		expect(canEditSchedule(owner, 'staff-2')).toBe(true);
		expect(canEditSchedule(staff, 'staff-2')).toBe(true);
		expect(canEditSchedule(staff, 'staff-1')).toBe(false);
		expect(canEditSchedule(unlinkedStaff, 'staff-1')).toBe(false);
	});
});
