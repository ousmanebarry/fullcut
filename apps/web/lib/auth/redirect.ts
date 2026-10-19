const BASE = 'http://internal.invalid';

// Returns a same-origin path from untrusted input (e.g. ?next=), or null; blocks open redirects.
export function safeRedirectPath(value: unknown): string | null {
	if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return null;
	if (/[\\\u0000-\u001f]/.test(value)) return null;

	let url: URL;
	try {
		url = new URL(value, BASE);
	} catch {
		return null;
	}
	if (url.origin !== BASE) return null;
	return `${url.pathname}${url.search}${url.hash}`;
}
