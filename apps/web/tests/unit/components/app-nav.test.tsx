// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const path = { current: '/dashboard' };
vi.mock('next/navigation', () => ({ usePathname: () => path.current }));
vi.mock('@/app/(auth)/actions', () => ({ signOut: vi.fn() }));
// next/link resolves its own copy of React under vitest.
vi.mock('next/link', () => ({
	default: ({ href, ...props }: React.ComponentProps<'a'>) => <a href={href} {...props} />,
}));

const { BottomTabBar, isActive } = await import('@/components/dashboard/app-nav');

beforeEach(() => {
	path.current = '/dashboard';
});
afterEach(cleanup);

describe('isActive', () => {
	it('matches Today exactly and other sections by prefix', () => {
		expect(isActive('/dashboard', '/dashboard')).toBe(true);
		expect(isActive('/dashboard/calendar', '/dashboard')).toBe(false);
		expect(isActive('/dashboard/clients/abc', '/dashboard/clients')).toBe(true);
		expect(isActive('/dashboard/clientsx', '/dashboard/clients')).toBe(false);
	});
});

describe('BottomTabBar', () => {
	it('marks the current tab and opens More for the remaining sections', async () => {
		path.current = '/dashboard/clients/abc';
		const user = userEvent.setup();
		render(<BottomTabBar />);

		const nav = screen.getByRole('navigation', { name: 'Main' });
		expect(nav.querySelector('[aria-current="page"]')?.textContent).toBe('Clients');

		await user.click(screen.getByRole('button', { name: 'More' }));
		const sheet = await screen.findByRole('dialog', { name: 'More' });
		for (const name of ['Inbox', 'Outcomes', 'Settings']) {
			expect(sheet.querySelector(`a[href="/dashboard/${name.toLowerCase()}"]`)).toBeTruthy();
		}
		expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
	});
});
