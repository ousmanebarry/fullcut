// Typed fetch wrappers for the public booking APIs, used by client components.
import type { AvailabilityResponse, BookingCreated, BookingDetails, PublicApiError } from './types';

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: PublicApiError };

const NETWORK_ERROR: PublicApiError = {
	error: 'invalid_request',
	message: 'We could not reach the booking service. Check your connection and try again.',
};

async function call<T>(input: string, init?: RequestInit): Promise<ApiResult<T>> {
	let res: Response;
	try {
		res = await fetch(input, init);
	} catch (error) {
		if (error instanceof DOMException && error.name === 'AbortError') throw error;
		return { ok: false, error: NETWORK_ERROR };
	}
	const body: unknown = await res.json().catch(() => null);
	if (res.ok) return { ok: true, data: body as T };
	if (body && typeof body === 'object' && 'error' in body) {
		return { ok: false, error: body as PublicApiError };
	}
	return { ok: false, error: NETWORK_ERROR };
}

const postJson = (body: unknown): RequestInit => ({
	method: 'POST',
	headers: { 'content-type': 'application/json' },
	body: JSON.stringify(body),
});

export function fetchAvailability(
	slug: string,
	query: { serviceId: string; staffId: string; from: string; to: string },
	signal?: AbortSignal,
) {
	const params = new URLSearchParams(query);
	return call<AvailabilityResponse>(
		`/api/public/${encodeURIComponent(slug)}/availability?${params}`,
		{ signal },
	);
}

export interface BookingRequest {
	serviceId: string;
	staffId: string;
	startsAt: string;
	name: string;
	phone: string;
	email?: string;
	notes?: string;
	marketingOptIn: boolean;
	expectedDepositCents: number;
	website: string;
}

export function createBooking(slug: string, body: BookingRequest, source: string | null) {
	const query = source ? `?src=${encodeURIComponent(source)}` : '';
	return call<BookingCreated>(
		`/api/public/${encodeURIComponent(slug)}/bookings${query}`,
		postJson(body),
	);
}

export function cancelBooking(token: string) {
	return call<{ status: 'cancelled' }>('/api/manage/cancel', postJson({ token }));
}

export function resumeCheckout(token: string) {
	return call<{ checkoutUrl: string }>('/api/manage/checkout', postJson({ token }));
}

export function rescheduleBooking(token: string, staffId: string, startsAt: string) {
	return call<{ booking: BookingDetails }>(
		'/api/manage/reschedule',
		postJson({ token, staffId, startsAt }),
	);
}
