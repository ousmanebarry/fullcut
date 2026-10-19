import { z } from 'zod';

const MAX_CENTS = 99_999_999;
// "35", "35.5", "35.50", "$1,250.00", ".50" — commas only as thousands separators.
const DOLLARS = /^\$?(\d{1,3}(?:,\d{3})+|\d*)(?:\.(\d{0,2}))?$/;

/** Parses a dollar amount typed by a person into integer cents, without floating point. */
export function parseDollarsToCents(input: string): number | null {
	const match = DOLLARS.exec(input.trim());
	if (!match) return null;
	const whole = (match[1] ?? '').replace(/,/g, '');
	const fraction = match[2] ?? '';
	if (whole === '' && fraction === '') return null;

	const cents = Number(whole || '0') * 100 + Number(fraction.padEnd(2, '0'));
	return cents <= MAX_CENTS ? cents : null;
}

/** Cents as a plain input value, e.g. 3550 → "35.50". */
export function centsToDollarInput(cents: number): string {
	return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

export function formatCents(cents: number, currency: string, locale = 'en-CA'): string {
	return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100);
}

export const dollarsToCentsSchema = z.string().transform((value, ctx) => {
	const cents = parseDollarsToCents(value);
	if (cents === null) {
		ctx.addIssue({ code: 'custom', message: 'Enter a price like 35 or 35.50.' });
		return z.NEVER;
	}
	return cents;
});
