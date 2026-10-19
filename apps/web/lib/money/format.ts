export function formatCents(cents: number, currency: string, locale = 'en-CA'): string {
	return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100);
}
