import { describe, expect, it } from 'vitest';
import { validateDetails } from '@/lib/public-booking/validate-details';

const VALID = { name: 'Sam Lee', phone: '+1 416 555 0101', email: '' };

describe('validateDetails', () => {
	it('accepts a name and phone with no email', () => {
		expect(validateDetails(VALID, () => true)).toEqual({});
	});

	it('requires a name and phone', () => {
		expect(validateDetails({ name: '  ', phone: '', email: '' }, () => true)).toEqual({
			name: 'Enter your name.',
			phone: 'Enter your mobile number.',
		});
	});

	it('checks the phone only once the phone library has loaded', () => {
		expect(validateDetails({ ...VALID, phone: '123' }, null)).toEqual({});
		expect(validateDetails({ ...VALID, phone: '123' }, () => false)).toEqual({
			phone: 'Enter a valid mobile number.',
		});
	});

	it('rejects a malformed optional email', () => {
		expect(validateDetails({ ...VALID, email: 'sam@' }, () => true)).toEqual({
			email: 'Enter a valid email or leave it blank.',
		});
		expect(validateDetails({ ...VALID, email: ' sam@example.com ' }, () => true)).toEqual({});
	});
});
