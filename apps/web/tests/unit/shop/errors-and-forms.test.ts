import { describe, expect, it } from 'vitest';
import { normalizePhone } from '@/lib/contact/phone';
import { toUserFacingError } from '@/lib/db/errors';
import { fieldErrorsFrom, formValues } from '@/lib/forms';
import { z } from 'zod';

describe('toUserFacingError', () => {
	it('maps a taken slug to the slug field', () => {
		expect(
			toUserFacingError({
				code: '23505',
				message: 'duplicate key value violates unique constraint "shops_slug_unique"',
			}),
		).toEqual({ field: 'slug', message: 'That link is already taken. Try another.' });
	});

	it('maps errors raised by our functions', () => {
		expect(toUserFacingError({ code: 'P0001', message: 'onboarding_already_member' }).message).toBe(
			'You already have a shop.',
		);
	});

	it('maps RLS denials and hides unknown details', () => {
		expect(
			toUserFacingError({ code: '42501', message: 'new row violates row-level security policy' })
				.message,
		).toMatch(/permission/);
		expect(toUserFacingError({ code: 'XX000', message: 'internal: secret detail' }).message).toBe(
			'Something went wrong. Try again.',
		);
	});
});

describe('normalizePhone', () => {
	it('normalises North American numbers to E.164', () => {
		expect(normalizePhone('416-555-0199', 'CA')).toBe('+14165550199');
		expect(normalizePhone('+1 (212) 555-0123', 'CA')).toBe('+12125550123');
		expect(normalizePhone('555', 'CA')).toBeNull();
		expect(normalizePhone('', 'US')).toBeNull();
	});
});

describe('form helpers', () => {
	it('keys zod errors by dotted path, first message wins', () => {
		const schema = z.object({
			a: z.object({ b: z.string().min(2, 'too short').max(1, 'too long') }),
		});
		const result = schema.safeParse({ a: { b: 'x' } });
		expect(fieldErrorsFrom(result.error!)).toEqual({ 'a.b': 'too short' });
	});

	it('echoes string values but not React action ids', () => {
		const data = new FormData();
		data.set('name', 'Sam');
		data.set('$ACTION_ID_abc', '');
		expect(formValues(data)).toEqual({ name: 'Sam' });
	});
});
