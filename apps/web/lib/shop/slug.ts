import { z } from 'zod';

// Top-level paths the app uses (or will), so a shop slug can never shadow them.
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
	'about',
	'account',
	'admin',
	'api',
	'app',
	'assets',
	'auth',
	'b',
	'billing',
	'blog',
	'book',
	'booking',
	'contact',
	'dashboard',
	'docs',
	'fullcut',
	'help',
	'legal',
	'login',
	'logout',
	'new',
	'onboarding',
	'pricing',
	'privacy',
	'public',
	'settings',
	'signin',
	'signout',
	'signup',
	'static',
	'status',
	'support',
	'terms',
	'www',
]);

export const SLUG_MIN = 3;
export const SLUG_MAX = 63;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function suggestSlug(name: string): string {
	return name
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/&/g, ' and ')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, SLUG_MAX)
		.replace(/-+$/, '');
}

export const slugSchema = z
	.string()
	.trim()
	.min(SLUG_MIN, { error: `Use at least ${SLUG_MIN} characters.` })
	.max(SLUG_MAX, { error: `Use ${SLUG_MAX} characters or fewer.` })
	.regex(SLUG_PATTERN, {
		error: 'Use lowercase letters, numbers and single hyphens (not at the start or end).',
	})
	.refine((slug) => !RESERVED_SLUGS.has(slug), { error: 'That link is reserved. Try another.' });
