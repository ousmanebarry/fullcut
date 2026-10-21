import { apiError, linkNotValid, notFound } from '@/lib/public-booking/responses';
import type { OfferClosedReason } from '@/lib/public-booking/types';
import type { ClaimFailure } from './claim';
import type { WaitlistFailure } from './join';

/** What the client reads when an offer can't be claimed (shared by the API and the claim page). */
export const OFFER_CLOSED_MESSAGES: Record<OfferClosedReason, string> = {
	taken: "Sorry, someone just took it - you're still on the waitlist.",
	expired: "Sorry, this offer has expired - you're still on the waitlist.",
	claimed:
		'This spot has already been booked with this link. Check your texts for the confirmation.',
	inactive: 'This offer is no longer available.',
};

export function claimFailureResponse(failure: ClaimFailure): Response {
	switch (failure.kind) {
		case 'invalid':
			return linkNotValid();
		case 'closed':
			return apiError(
				{
					error: 'offer_closed',
					reason: failure.reason,
					message: OFFER_CLOSED_MESSAGES[failure.reason],
				},
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
	}
}

export function waitlistFailureResponse(failure: WaitlistFailure): Response {
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
		case 'disabled':
			return apiError(
				{ error: 'waitlist_disabled', message: 'This shop is not taking waitlist requests.' },
				409,
			);
		case 'too_many':
			return apiError(
				{
					error: 'too_many_waitlist_entries',
					message:
						'You are already on the waitlist as many times as this shop allows. Leave one from its link, or call the shop.',
				},
				409,
			);
		case 'opted_out':
			return apiError(
				{
					error: 'sms_opted_out',
					message:
						'You replied STOP to our texts, so we cannot text you. Reply START to turn texts back on, then join again.',
				},
				409,
			);
	}
}
