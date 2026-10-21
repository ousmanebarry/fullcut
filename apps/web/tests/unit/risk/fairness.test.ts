import { describe, expect, it } from 'vitest';
import { confirmedShowStreak, fairnessCapReached, type PastBooking } from '@/lib/risk/fairness';
import {
	DEFAULT_RISK_SETTINGS,
	riskSettingsPreview,
	suggestsStandby,
	type BookingRisk,
} from '@/lib/risk/types';

const NOW = Date.UTC(2026, 9, 20);
const day = 86_400_000;
const past = (daysAgo: number, status: string, confirmationStatus: string): PastBooking => ({
	status,
	confirmationStatus,
	startsAtMs: NOW - daysAgo * day,
});

describe('fairness cap', () => {
	it('counts the latest visits where the client was asked and came', () => {
		const history = [
			past(10, 'completed', 'confirmed'),
			past(40, 'completed', 'unconfirmed'),
			past(70, 'completed', 'requested'),
			past(100, 'no_show', 'requested'),
			past(130, 'completed', 'confirmed'),
		];
		expect(confirmedShowStreak(history, NOW)).toBe(3);
		expect(fairnessCapReached(history, 3, NOW)).toBe(true);
		expect(fairnessCapReached(history, 4, NOW)).toBe(false);
	});

	it('a missed visit or a visit without a request breaks the streak', () => {
		expect(confirmedShowStreak([past(5, 'no_show', 'requested')], NOW)).toBe(0);
		expect(
			confirmedShowStreak(
				[past(5, 'completed', 'not_required'), past(30, 'completed', 'confirmed')],
				NOW,
			),
		).toBe(0);
	});

	it('ignores cancelled, released and future bookings', () => {
		const history = [
			past(-3, 'confirmed', 'requested'),
			past(4, 'cancelled', 'released'),
			past(8, 'completed', 'confirmed'),
		];
		expect(confirmedShowStreak(history, NOW)).toBe(1);
	});
});

const risk = (tier: BookingRisk['tier'], trusted = false): BookingRisk => ({
	tier,
	score: 0.5,
	method: 'heuristic',
	factors: [],
	trusted,
});
const on = { ...DEFAULT_RISK_SETTINGS, actionsEnabled: true };

describe('suggestsStandby', () => {
	it('always for unconfirmed bookings', () => {
		expect(
			suggestsStandby({ risk: null, confirmation: 'unconfirmed' }, DEFAULT_RISK_SETTINGS),
		).toBe(true);
	});

	it('per tier when actions are on and the client is not trusted', () => {
		expect(suggestsStandby({ risk: risk('high'), confirmation: 'requested' }, on)).toBe(true);
		expect(suggestsStandby({ risk: risk('medium'), confirmation: 'requested' }, on)).toBe(false);
		expect(suggestsStandby({ risk: risk('high', true), confirmation: 'not_required' }, on)).toBe(
			false,
		);
		expect(
			suggestsStandby({ risk: risk('high'), confirmation: 'requested' }, DEFAULT_RISK_SETTINGS),
		).toBe(false);
	});
});

describe('riskSettingsPreview', () => {
	it('says plainly that nothing happens when actions are off', () => {
		expect(riskSettingsPreview(DEFAULT_RISK_SETTINGS)).toEqual([
			'Automated actions are off. Risk badges still show on bookings, but nothing is sent or changed because of them.',
		]);
	});

	it('describes each tier with its share of bookings', () => {
		expect(riskSettingsPreview(on, { high: 0.1, medium: 0.25 })).toEqual([
			'High-risk bookings (about 1 in 10) will be asked to reply YES by 24 h before; unconfirmed ones are flagged for you, get an extra reminder 3 h before, show standby clients from your waitlist.',
			'Medium-risk bookings (about 1 in 4) get a "reply YES to confirm" text 48 h before.',
			"A client who showed up after 3 confirmation requests in a row isn't asked again for their next booking.",
		]);
	});

	it('mentions releases only when auto-release is on', () => {
		const [high] = riskSettingsPreview({ ...on, autoRelease: true });
		expect(high).toContain('released and offered to your waitlist');
	});
});
