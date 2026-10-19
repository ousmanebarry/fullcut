import { describe, expect, it } from 'vitest';
import { RESERVED_SLUGS, slugSchema, suggestSlug } from '@/lib/shop/slug';

describe('suggestSlug', () => {
	it.each([
		['Demo Barbers', 'demo-barbers'],
		["Sam's Cuts & Shaves", 'sam-s-cuts-and-shaves'],
		['  Café Coiffure  ', 'cafe-coiffure'],
		['Fade -- Lab!!', 'fade-lab'],
		['123 Main St.', '123-main-st'],
		['!!!', ''],
	])('%j → %j', (name, slug) => {
		expect(suggestSlug(name)).toBe(slug);
	});

	it('caps the length without leaving a trailing hyphen', () => {
		const slug = suggestSlug(`${'a'.repeat(62)} b`);
		expect(slug.length).toBeLessThanOrEqual(63);
		expect(slug.endsWith('-')).toBe(false);
	});

	it('always produces a valid slug for normal names', () => {
		for (const name of ['Demo Barbers', 'The Chair', 'Kutz 4 Kidz']) {
			expect(slugSchema.safeParse(suggestSlug(name)).success).toBe(true);
		}
	});
});

describe('slugSchema', () => {
	it.each(['abc', 'demo-barbers', 'shop-2', 'a1b2c3'])('accepts %j', (slug) => {
		expect(slugSchema.safeParse(slug).success).toBe(true);
	});

	it.each([
		'ab',
		'Demo',
		'demo_barbers',
		'-demo',
		'demo-',
		'demo--barbers',
		'demo barbers',
		'é-shop',
		'a'.repeat(64),
	])('rejects %j', (slug) => {
		expect(slugSchema.safeParse(slug).success).toBe(false);
	});

	it.each(['dashboard', 'api', 'login', 'signup', 'onboarding', 'auth', 'b'])(
		'rejects reserved %j',
		(slug) => {
			const result = slugSchema.safeParse(slug);
			expect(result.success).toBe(false);
		},
	);

	it('reserves every top-level app route', () => {
		for (const route of ['dashboard', 'api', 'login', 'signup', 'onboarding', 'auth']) {
			expect(RESERVED_SLUGS.has(route)).toBe(true);
		}
	});

	it('trims surrounding whitespace', () => {
		expect(slugSchema.parse('  demo-barbers ')).toBe('demo-barbers');
	});
});
