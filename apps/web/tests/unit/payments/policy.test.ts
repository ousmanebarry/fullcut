import { describe, expect, it } from 'vitest';
import {
	describeCancellationPolicy,
	depositFor,
	paymentState,
	platformFeeCents,
	refundAmount,
	type CancellationPolicy,
	type DepositPolicy,
} from '@/lib/payments/policy';
import { instantFromIso, type Instant } from '@/lib/time';

const at = (iso: string): Instant => instantFromIso(iso);
const SECOND = 1000;

const policy: CancellationPolicy = {
	freeCancelHours: 24,
	lateCancelKeepsDeposit: true,
	noShowKeepsDeposit: true,
};

describe('depositFor', () => {
	const cut = { priceCents: 4000, depositCents: 1000 };
	const fixed: DepositPolicy = {
		mode: 'all_bookings',
		defaultType: 'fixed',
		defaultCents: 1500,
		defaultPercent: 0,
	};

	it('takes nothing while Stripe cannot accept charges', () => {
		expect(depositFor(fixed, cut, false)).toBe(0);
	});

	it('takes nothing when deposits are off', () => {
		expect(depositFor({ ...fixed, mode: 'off' }, cut, true)).toBe(0);
	});

	it('uses the fixed default for every booking', () => {
		expect(depositFor(fixed, cut, true)).toBe(1500);
	});

	it('uses a percentage of the price, rounded to the cent', () => {
		const percent: DepositPolicy = { ...fixed, defaultType: 'percent', defaultPercent: 25 };
		expect(depositFor(percent, cut, true)).toBe(1000);
		expect(depositFor(percent, { priceCents: 3333, depositCents: 0 }, true)).toBe(833);
	});

	it("uses each service's own deposit in per-service mode", () => {
		expect(depositFor({ ...fixed, mode: 'per_service' }, cut, true)).toBe(1000);
		expect(depositFor({ ...fixed, mode: 'per_service' }, { ...cut, depositCents: 0 }, true)).toBe(
			0,
		);
	});

	it('never exceeds the price', () => {
		expect(depositFor({ ...fixed, defaultCents: 9000 }, cut, true)).toBe(4000);
	});

	it('skips deposits below what Stripe can charge', () => {
		expect(depositFor({ ...fixed, defaultCents: 49 }, cut, true)).toBe(0);
		expect(depositFor({ ...fixed, defaultCents: 50 }, cut, true)).toBe(50);
		expect(depositFor(fixed, { priceCents: 0, depositCents: 0 }, true)).toBe(0);
	});
});

describe('platformFeeCents', () => {
	it('is zero', () => {
		expect(platformFeeCents()).toBe(0);
	});
});

describe('refundAmount', () => {
	const booking = { startsAt: at('2026-06-10T14:00:00Z'), paidCents: 2000 };
	const deadline = at('2026-06-09T14:00:00Z');

	it('refunds in full exactly at the free-cancellation boundary', () => {
		expect(refundAmount(policy, booking, deadline, 'client')).toBe(2000);
	});

	it('keeps the deposit one second after the boundary', () => {
		expect(refundAmount(policy, booking, (deadline + SECOND) as Instant, 'client')).toBe(0);
	});

	it('refunds late cancellations when the policy does not keep the deposit', () => {
		const lenient = { ...policy, lateCancelKeepsDeposit: false };
		expect(refundAmount(lenient, booking, (deadline + SECOND) as Instant, 'client')).toBe(2000);
	});

	it('always refunds in full when the shop cancels', () => {
		expect(refundAmount(policy, booking, booking.startsAt, 'shop')).toBe(2000);
	});

	it('refunds in full for system and unattributed cancellations', () => {
		expect(refundAmount(policy, booking, booking.startsAt, 'system')).toBe(2000);
		expect(refundAmount(policy, booking, booking.startsAt, null)).toBe(2000);
	});

	it('with a zero-hour window, refunds until the start and keeps it after', () => {
		const zero = { ...policy, freeCancelHours: 0 };
		expect(refundAmount(zero, booking, booking.startsAt, 'client')).toBe(2000);
		expect(refundAmount(zero, booking, (booking.startsAt + SECOND) as Instant, 'client')).toBe(0);
	});

	// Toronto springs forward at 2026-03-08 02:00: 24 elapsed hours before 12:00 EDT is 11:00 EST.
	it('measures real hours across the spring-forward change', () => {
		const sunday = { startsAt: at('2026-03-08T16:00:00Z'), paidCents: 2000 };
		expect(refundAmount(policy, sunday, at('2026-03-07T16:00:00Z'), 'client')).toBe(2000);
		expect(refundAmount(policy, sunday, at('2026-03-07T16:00:01Z'), 'client')).toBe(0);
		// 11:30 EST Saturday is "before noon" on the wall clock but only 23.5 real hours ahead.
		expect(refundAmount(policy, sunday, at('2026-03-07T16:30:00Z'), 'client')).toBe(0);
	});

	// Toronto falls back at 2026-11-01 02:00: 24 elapsed hours before 12:00 EST is 13:00 EDT.
	it('measures real hours across the fall-back change', () => {
		const sunday = { startsAt: at('2026-11-01T17:00:00Z'), paidCents: 2000 };
		expect(refundAmount(policy, sunday, at('2026-10-31T17:00:00Z'), 'client')).toBe(2000);
		expect(refundAmount(policy, sunday, at('2026-10-31T17:00:01Z'), 'client')).toBe(0);
		// 12:30 EDT Saturday is "after noon" on the wall clock but 24.5 real hours ahead.
		expect(refundAmount(policy, sunday, at('2026-10-31T16:30:00Z'), 'client')).toBe(2000);
	});
});

describe('describeCancellationPolicy', () => {
	it('states the window, the amount and what happens after', () => {
		expect(describeCancellationPolicy(policy, 2000, 'CAD')).toEqual([
			'Cancel at least 24 hours before your appointment and the $20.00 deposit is refunded. After that, the deposit is kept.',
			'If you miss the appointment, the deposit is kept.',
		]);
	});

	it('describes a fully refundable deposit', () => {
		expect(
			describeCancellationPolicy(
				{ freeCancelHours: 24, lateCancelKeepsDeposit: false, noShowKeepsDeposit: false },
				1500,
				'CAD',
			),
		).toEqual([
			'Cancel any time before your appointment and the $15.00 deposit is refunded.',
			'If you miss the appointment, the shop will refund the deposit.',
		]);
	});

	it('uses singular hours', () => {
		expect(describeCancellationPolicy({ ...policy, freeCancelHours: 1 }, 1000, 'CAD')[0]).toMatch(
			/at least 1 hour before/,
		);
	});
});

describe('paymentState', () => {
	const paid = { status: 'succeeded', amountCents: 2000, refundDueCents: 0, refundedCents: 0 };

	it('follows the payment through refunds', () => {
		expect(paymentState({ ...paid, status: 'pending' })).toBe('awaiting_payment');
		expect(paymentState({ ...paid, status: 'expired' })).toBe('expired');
		expect(paymentState(paid)).toBe('paid');
		expect(paymentState({ ...paid, refundDueCents: 2000 })).toBe('refund_pending');
		expect(paymentState({ ...paid, refundDueCents: 1000, refundedCents: 1000 })).toBe(
			'partially_refunded',
		);
		expect(paymentState({ ...paid, refundDueCents: 2000, refundedCents: 2000 })).toBe('refunded');
	});
});
