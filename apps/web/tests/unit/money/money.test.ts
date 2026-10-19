import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
	centsToDollarInput,
	dollarsToCentsSchema,
	formatCents,
	parseDollarsToCents,
} from '@/lib/money';

describe('parseDollarsToCents', () => {
	it.each([
		['35', 3500],
		['35.5', 3550],
		['35.50', 3550],
		['35.', 3500],
		['0.07', 7],
		['.5', 50],
		['$40', 4000],
		['1,250.00', 125000],
		[' 19.99 ', 1999],
		['0', 0],
	])('%j → %d', (input, cents) => {
		expect(parseDollarsToCents(input)).toBe(cents);
	});

	it.each(['', '.', '$', 'abc', '-5', '35.505', '1,25', '12,34.00', '35,50', '1e3', '999999999'])(
		'rejects %j',
		(input) => {
			expect(parseDollarsToCents(input)).toBeNull();
		},
	);

	it('avoids float rounding errors', () => {
		expect(parseDollarsToCents('0.29')).toBe(29);
		expect(parseDollarsToCents('1.15')).toBe(115);
		expect(parseDollarsToCents('4.35')).toBe(435);
	});

	it('round-trips through centsToDollarInput', () => {
		fc.assert(
			fc.property(fc.integer({ min: 0, max: 99_999_999 }), (cents) => {
				expect(parseDollarsToCents(centsToDollarInput(cents))).toBe(cents);
			}),
		);
	});
});

describe('centsToDollarInput', () => {
	it('pads cents', () => {
		expect(centsToDollarInput(3505)).toBe('35.05');
		expect(centsToDollarInput(0)).toBe('0.00');
	});
});

describe('formatCents', () => {
	it('formats with the currency', () => {
		expect(formatCents(3550, 'CAD')).toBe('$35.50');
		expect(formatCents(3550, 'USD', 'en-US')).toBe('$35.50');
	});
});

describe('dollarsToCentsSchema', () => {
	it('returns cents or a friendly error', () => {
		expect(dollarsToCentsSchema.parse('12.30')).toBe(1230);
		const result = dollarsToCentsSchema.safeParse('twelve');
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.message).toMatch(/price like/);
	});
});
