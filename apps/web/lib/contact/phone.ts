import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/min';

export function countryForCurrency(currency: string): CountryCode {
	return currency === 'USD' ? 'US' : 'CA';
}

/** Normalises a typed phone number to E.164, or null if it is not a valid number. */
export function normalizePhone(input: string, defaultCountry: CountryCode): string | null {
	const parsed = parsePhoneNumberFromString(input.trim(), defaultCountry);
	return parsed?.isValid() ? parsed.number : null;
}
