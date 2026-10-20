import type { z } from 'zod';
import type { StartRejection } from '@/lib/booking/validate-requested-start';
import { fieldErrorsFrom } from '@/lib/forms';
import type { BookingFailure } from './booking';
import type { PublicApiError } from './types';

const NO_STORE = { 'Cache-Control': 'no-store' };

const TAKEN_MESSAGE = 'That time was just taken — here are the nearest open times.';

const REJECTION_MESSAGES: Record<StartRejection, string> = {
	misaligned: 'Please pick one of the listed times.',
	too_soon: 'That time is too soon to book online.',
	too_far: 'That time is too far ahead to book online.',
	outside_hours: 'That time is outside opening hours.',
	time_off: 'Nobody is available at that time.',
	conflict: TAKEN_MESSAGE,
};

export function apiError(
	body: PublicApiError,
	status: number,
	headers: Record<string, string> = {},
): Response {
	return Response.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

export function invalidRequest(error?: z.ZodError, message = 'Check the highlighted fields.') {
	return apiError(
		{
			error: 'invalid_request',
			message,
			...(error ? { fieldErrors: fieldErrorsFrom(error) } : {}),
		},
		400,
	);
}

export function notFound(message = 'This booking page is not available.') {
	return apiError({ error: 'not_found', message }, 404);
}

export function rateLimited(retryAfterSeconds: number) {
	return apiError(
		{
			error: 'rate_limited',
			message: 'Too many attempts. Please wait a little and try again.',
			retryAfterSeconds,
		},
		429,
		{ 'Retry-After': String(retryAfterSeconds) },
	);
}

export function linkNotValid() {
	return notFound('This link is not valid or has expired.');
}

export function failureResponse(failure: BookingFailure): Response {
	switch (failure.kind) {
		case 'invalid':
			return apiError(
				{
					error: 'invalid_request',
					message: 'Check the highlighted fields.',
					fieldErrors: failure.fieldErrors,
				},
				400,
			);
		case 'not_found':
			return notFound('That service or stylist is no longer available.');
		case 'unavailable':
			if (failure.reason === 'conflict') {
				return apiError(
					{ error: 'slot_taken', message: TAKEN_MESSAGE, suggestions: failure.suggestions },
					409,
				);
			}
			return apiError(
				{
					error: 'slot_unavailable',
					reason: failure.reason,
					message: REJECTION_MESSAGES[failure.reason],
					suggestions: failure.suggestions,
				},
				422,
			);
		case 'taken':
			return apiError(
				{ error: 'slot_taken', message: TAKEN_MESSAGE, suggestions: failure.suggestions },
				409,
			);
		case 'too_many':
			return apiError(
				{
					error: 'too_many_bookings',
					message:
						'You already have the most upcoming bookings allowed here. Change an existing one or call the shop.',
				},
				409,
			);
		case 'not_active':
			return apiError(
				{ error: 'not_active', message: 'This booking can no longer be changed.' },
				409,
			);
		case 'cancel_window_passed':
			return apiError(
				{
					error: 'cancel_window_passed',
					message: "It's too close to your appointment to change it online. Please call the shop.",
				},
				422,
			);
		case 'deposit_changed':
			return apiError(
				{
					error: 'deposit_changed',
					message:
						failure.depositCents > 0
							? 'The deposit for this service has changed. Please check it and confirm again.'
							: 'This shop no longer takes a deposit online. Please check and confirm again.',
					depositCents: failure.depositCents,
				},
				409,
			);
		case 'payment_unavailable':
			return apiError(
				{
					error: 'payment_unavailable',
					message: "We couldn't start the payment, so nothing was booked. Please try again.",
				},
				503,
			);
	}
}

/** Parses a JSON body without throwing; null if it is not a JSON object. */
export async function readJson(request: Request): Promise<unknown> {
	try {
		return await request.json();
	} catch {
		return null;
	}
}
