import { localDateOf, type Instant, type TimeZone } from '@/lib/time';
import type { BookingEvent, BookingStatus, Result } from './types';

export type TransitionError =
	| { code: 'invalid_transition'; from: BookingStatus; event: BookingEvent }
	| { code: 'too_early'; event: 'markCompleted' | 'markNoShow' }
	| { code: 'hold_not_expired' }
	| { code: 'undo_window_passed' };

export interface TransitionSubject {
	status: BookingStatus;
	startsAt: Instant;
	pendingExpiresAt: Instant | null;
	outcomeMarkedAt?: Instant | null;
}

const TRANSITIONS: Readonly<Record<BookingStatus, Partial<Record<BookingEvent, BookingStatus>>>> = {
	pending: {
		depositPaid: 'confirmed',
		confirmWithoutDeposit: 'confirmed',
		holdExpired: 'cancelled',
		cancel: 'cancelled',
	},
	confirmed: { cancel: 'cancelled', markCompleted: 'completed', markNoShow: 'no_show' },
	completed: { undoOutcome: 'confirmed' },
	cancelled: {},
	no_show: { undoOutcome: 'confirmed' },
};

/** `zone` is needed for `undoOutcome`, which is allowed until the end of the shop-local day the outcome was marked. */
export function transitionBooking(
	booking: TransitionSubject,
	event: BookingEvent,
	now: Instant,
	zone?: TimeZone,
): Result<BookingStatus, TransitionError> {
	const next = TRANSITIONS[booking.status][event];
	if (!next)
		return { ok: false, error: { code: 'invalid_transition', from: booking.status, event } };

	if ((event === 'markCompleted' || event === 'markNoShow') && now < booking.startsAt) {
		return { ok: false, error: { code: 'too_early', event } };
	}
	if (
		event === 'holdExpired' &&
		(booking.pendingExpiresAt === null || now < booking.pendingExpiresAt)
	) {
		return { ok: false, error: { code: 'hold_not_expired' } };
	}
	if (
		event === 'undoOutcome' &&
		(!booking.outcomeMarkedAt ||
			!zone ||
			localDateOf(booking.outcomeMarkedAt, zone) !== localDateOf(now, zone))
	) {
		return { ok: false, error: { code: 'undo_window_passed' } };
	}
	return { ok: true, value: next };
}
