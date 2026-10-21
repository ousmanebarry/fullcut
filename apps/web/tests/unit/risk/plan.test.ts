import { describe, expect, it } from 'vitest';
import { latestSendableBefore, NO_PLAN, planRiskActions, type PlanInput } from '@/lib/risk/plan';
import { DEFAULT_RISK_SETTINGS } from '@/lib/risk/types';
import { instantFromIso, timeZone } from '@/lib/time';

const toronto = timeZone('America/Toronto');
const at = (iso: string) => instantFromIso(iso);

// Tue Oct 27, 11:00 EDT; scored a week earlier at noon.
const base: PlanInput = {
	tier: 'high',
	settings: { ...DEFAULT_RISK_SETTINGS, actionsEnabled: true },
	source: 'direct',
	trusted: false,
	confirmationStatus: 'not_required',
	fairnessCapReached: false,
	startsAt: at('2026-10-27T15:00:00Z'),
	now: at('2026-10-20T16:00:00Z'),
	timezone: toronto,
	minNoticeMinutes: 60,
};

describe('planRiskActions', () => {
	it('high risk: request 48 h before, warning outside quiet hours, deadline 24 h before', () => {
		expect(planRiskActions(base)).toEqual({
			confirmRequestAt: at('2026-10-25T15:00:00Z'),
			// The warning would land at 08:00 EDT (quiet hours), so it goes at 20:30 the evening before.
			finalWarningAt: at('2026-10-26T00:30:00Z'),
			confirmationDueAt: at('2026-10-26T15:00:00Z'),
			extraReminderAt: at('2026-10-27T12:00:00Z'),
		});
	});

	it('medium risk by default only asks for a reply', () => {
		expect(planRiskActions({ ...base, tier: 'medium' })).toEqual({
			...NO_PLAN,
			confirmRequestAt: at('2026-10-25T15:00:00Z'),
		});
	});

	it.each([
		['actions are off', { settings: DEFAULT_RISK_SETTINGS }],
		['the tier is low', { tier: 'low' as const }],
		['the score is unknown', { tier: 'unknown' as const }],
		['the owner trusts the client', { trusted: true }],
		['it is a walk-in', { source: 'walk_in' }],
	])('does nothing when %s', (_label, overrides) => {
		expect(planRiskActions({ ...base, ...overrides })).toEqual(NO_PLAN);
	});

	it('the fairness cap stops the request but keeps the extra reminder', () => {
		expect(planRiskActions({ ...base, fairnessCapReached: true })).toEqual({
			...NO_PLAN,
			extraReminderAt: at('2026-10-27T12:00:00Z'),
		});
	});

	it('a client who already confirmed is not asked again', () => {
		const plan = planRiskActions({ ...base, confirmationStatus: 'confirmed' });
		expect(plan.confirmRequestAt).toBeNull();
		expect(plan.confirmationDueAt).toBeNull();
	});

	it('a booking made too late for the full timeline gets a request only, never a deadline', () => {
		// Booked at noon for 08:00 next morning.
		const plan = planRiskActions({ ...base, startsAt: at('2026-10-21T12:00:00Z') });
		expect(plan.confirmRequestAt).toBe(base.now);
		expect(plan.finalWarningAt).toBeNull();
		expect(plan.confirmationDueAt).toBeNull();
	});

	it('the deadline is never later than the waitlist minimum notice', () => {
		const plan = planRiskActions({
			...base,
			settings: { ...base.settings, deadlineHours: 12 },
			minNoticeMinutes: 24 * 60,
		});
		expect(plan.confirmationDueAt).toBe(at('2026-10-26T15:00:00Z'));
	});

	it('the final warning leaves time to reply to the request', () => {
		const plan = planRiskActions(base);
		expect(plan.finalWarningAt! - plan.confirmRequestAt!).toBeGreaterThanOrEqual(2 * 3_600_000);
		expect(plan.finalWarningAt!).toBeLessThan(plan.confirmationDueAt!);
	});

	it('nothing is asked within 3 hours of the start', () => {
		const plan = planRiskActions({ ...base, startsAt: at('2026-10-20T18:30:00Z') });
		expect(plan).toEqual(NO_PLAN);
	});

	it('across the fall-back DST change the warning still lands at 20:30 local', () => {
		// Mon Nov 2, 10:00 EST; deadline Sun Nov 1 10:00 EST, warning would be 07:00 EST.
		const plan = planRiskActions({
			...base,
			startsAt: at('2026-11-02T15:00:00Z'),
			now: at('2026-10-27T16:00:00Z'),
		});
		expect(plan.confirmationDueAt).toBe(at('2026-11-01T15:00:00Z'));
		// Sat Oct 31, 20:30 EDT.
		expect(plan.finalWarningAt).toBe(at('2026-11-01T00:30:00Z'));
	});
});

describe('latestSendableBefore', () => {
	it.each([
		['12:00 EDT stays', '2026-10-20T16:00:00Z', '2026-10-20T16:00:00Z'],
		['22:00 EDT moves to 20:30 the same evening', '2026-10-21T02:00:00Z', '2026-10-21T00:30:00Z'],
		['03:00 EDT moves to 20:30 the evening before', '2026-10-21T07:00:00Z', '2026-10-21T00:30:00Z'],
	])('%s', (_label, input, expected) => {
		expect(latestSendableBefore(at(input), toronto)).toBe(at(expected));
	});
});
