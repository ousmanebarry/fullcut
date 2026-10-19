import { describe, expect, it } from 'vitest';
import { transitionBooking } from '@/lib/booking/transition-booking';
import type { BookingEvent, BookingStatus } from '@/lib/booking/types';
import { at, toronto } from './fixtures';

const startsAt = at('2026-03-10T14:00:00Z');
const pendingExpiresAt = at('2026-03-09T12:15:00Z');
const later = at('2026-03-10T15:00:00Z');

const statuses: BookingStatus[] = ['pending', 'confirmed', 'completed', 'cancelled', 'no_show'];
const events: BookingEvent[] = [
	'depositPaid',
	'confirmWithoutDeposit',
	'holdExpired',
	'cancel',
	'markCompleted',
	'markNoShow',
];

const allowed: Partial<Record<BookingStatus, Partial<Record<BookingEvent, BookingStatus>>>> = {
	pending: {
		depositPaid: 'confirmed',
		confirmWithoutDeposit: 'confirmed',
		holdExpired: 'cancelled',
		cancel: 'cancelled',
	},
	confirmed: { cancel: 'cancelled', markCompleted: 'completed', markNoShow: 'no_show' },
};

describe('transitionBooking', () => {
	const cases = statuses.flatMap((from) =>
		events.map((event) => [from, event, allowed[from]?.[event]] as const),
	);

	it.each(cases)('%s + %s -> %s', (from, event, to) => {
		const result = transitionBooking({ status: from, startsAt, pendingExpiresAt }, event, later);
		expect(result).toEqual(
			to
				? { ok: true, value: to }
				: { ok: false, error: { code: 'invalid_transition', from, event } },
		);
	});

	it.each(['markCompleted', 'markNoShow'] as const)(
		'rejects %s before the appointment starts',
		(event) => {
			const before = at('2026-03-10T13:59:00Z');
			expect(
				transitionBooking({ status: 'confirmed', startsAt, pendingExpiresAt: null }, event, before),
			).toEqual({
				ok: false,
				error: { code: 'too_early', event },
			});
			expect(
				transitionBooking(
					{ status: 'confirmed', startsAt, pendingExpiresAt: null },
					event,
					startsAt,
				).ok,
			).toBe(true);
		},
	);

	it('rejects holdExpired before the hold expires, and for holds without an expiry', () => {
		const before = at('2026-03-09T12:14:00Z');
		expect(
			transitionBooking({ status: 'pending', startsAt, pendingExpiresAt }, 'holdExpired', before),
		).toEqual({
			ok: false,
			error: { code: 'hold_not_expired' },
		});
		expect(
			transitionBooking(
				{ status: 'pending', startsAt, pendingExpiresAt },
				'holdExpired',
				pendingExpiresAt,
			),
		).toEqual({
			ok: true,
			value: 'cancelled',
		});
		expect(
			transitionBooking(
				{ status: 'pending', startsAt, pendingExpiresAt: null },
				'holdExpired',
				later,
			).ok,
		).toBe(false);
	});

	describe('undoOutcome', () => {
		// 2026-11-01 is the fall-back day in Toronto: local midnight is 04:00Z before, 05:00Z after.
		const markedAt = at('2026-11-01T14:00:00Z');
		const outcome = (status: BookingStatus) => ({
			status,
			startsAt: at('2026-11-01T13:00:00Z'),
			pendingExpiresAt: null,
			outcomeMarkedAt: markedAt,
		});

		it.each(['completed', 'no_show'] as const)(
			'returns %s to confirmed until the end of that shop-local day',
			(status) => {
				const lastMinute = at('2026-11-02T04:59:00Z');
				expect(transitionBooking(outcome(status), 'undoOutcome', lastMinute, toronto)).toEqual({
					ok: true,
					value: 'confirmed',
				});
				expect(
					transitionBooking(outcome(status), 'undoOutcome', at('2026-11-02T05:00:00Z'), toronto),
				).toEqual({ ok: false, error: { code: 'undo_window_passed' } });
			},
		);

		it('needs the marked time and the shop zone', () => {
			const now = at('2026-11-01T15:00:00Z');
			expect(transitionBooking(outcome('completed'), 'undoOutcome', now).ok).toBe(false);
			expect(
				transitionBooking(
					{ ...outcome('completed'), outcomeMarkedAt: null },
					'undoOutcome',
					now,
					toronto,
				).ok,
			).toBe(false);
		});

		it.each(['pending', 'confirmed', 'cancelled'] as const)('is not allowed from %s', (status) => {
			expect(
				transitionBooking(outcome(status), 'undoOutcome', at('2026-11-01T15:00:00Z'), toronto),
			).toEqual({
				ok: false,
				error: { code: 'invalid_transition', from: status, event: 'undoOutcome' },
			});
		});
	});
});
