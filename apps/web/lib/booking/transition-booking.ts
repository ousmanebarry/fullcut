import type { Instant } from '@/lib/time';
import type { BookingEvent, BookingStatus, Result } from './types';

export type TransitionError =
	| { code: 'invalid_transition'; from: BookingStatus; event: BookingEvent }
	| { code: 'too_early'; event: 'markCompleted' | 'markNoShow' }
	| { code: 'hold_not_expired' };

const TRANSITIONS: Readonly<Record<BookingStatus, Partial<Record<BookingEvent, BookingStatus>>>> = {
	pending: {
		depositPaid: 'confirmed',
		confirmWithoutDeposit: 'confirmed',
		holdExpired: 'cancelled',
		cancel: 'cancelled',
	},
	confirmed: { cancel: 'cancelled', markCompleted: 'completed', markNoShow: 'no_show' },
	completed: {},
	cancelled: {},
	no_show: {},
};

export function transitionBooking(
	booking: { status: BookingStatus; startsAt: Instant; pendingExpiresAt: Instant | null },
	event: BookingEvent,
	now: Instant,
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
	return { ok: true, value: next };
}
