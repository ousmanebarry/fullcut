// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeToggle } from '@/components/theme/theme-toggle';

let systemDark = false;

beforeEach(() => {
	localStorage.clear();
	document.documentElement.className = '';
	document.head.innerHTML = '<meta name="theme-color" content="#ffffff">';
	vi.stubGlobal(
		'matchMedia',
		vi.fn((query: string) => ({
			matches: query === '(prefers-color-scheme: dark)' && systemDark,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
		})),
	);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	systemDark = false;
});

const isDark = () => document.documentElement.classList.contains('dark');
const themeColor = () =>
	document.querySelector('meta[name="theme-color"]')?.getAttribute('content');

describe('ThemeToggle', () => {
	it('cycles system → light → dark → system and persists the choice', async () => {
		systemDark = true;
		const user = userEvent.setup();
		render(<ThemeToggle />);
		const button = screen.getByRole('button', { name: /^Theme: System/ });

		await user.click(button);
		expect(button.getAttribute('aria-label')).toBe('Theme: Light. Switch to dark');
		expect(localStorage.getItem('fullcut:theme')).toBe('light');
		expect(isDark()).toBe(false);
		expect(themeColor()).toBe('#ffffff');

		await user.click(button);
		expect(button.getAttribute('aria-label')).toBe('Theme: Dark. Switch to system');
		expect(localStorage.getItem('fullcut:theme')).toBe('dark');
		expect(isDark()).toBe(true);
		expect(document.documentElement.style.colorScheme).toBe('dark');
		expect(themeColor()).toBe('#0a0a0a');

		await user.click(button);
		expect(button.getAttribute('aria-label')).toBe('Theme: System. Switch to light');
		expect(localStorage.getItem('fullcut:theme')).toBeNull();
		// Back to following the OS, which is dark here.
		expect(isDark()).toBe(true);
	});

	it('reads a stored preference', () => {
		localStorage.setItem('fullcut:theme', 'dark');
		render(<ThemeToggle />);
		expect(screen.getByRole('button', { name: /^Theme: Dark/ })).toBeTruthy();
	});
});
