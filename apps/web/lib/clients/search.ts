const LIKE_SPECIALS = /[\\%_]/g;

/**
 * Name (contains) or phone (digits contained) pattern for a typed search.
 * Formatting is ignored, so "(416) 555-0123" finds +14165550123.
 */
export function clientSearchPattern(query: string): { phone: string } | { name: string } {
	const digits = query.replace(/\D/g, '');
	if (digits.length >= 3 && !/[a-z]/i.test(query)) return { phone: `%${digits}%` };
	return { name: `%${query.trim().replace(LIKE_SPECIALS, '\\$&')}%` };
}
