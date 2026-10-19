import { describe, expect, it } from 'vitest';
import { computeBookingTimes } from '@/lib/booking/compute-booking-times';
import type { SchedulingContext } from '@/lib/booking/types';
import { validateRequestedStart, validateStaffStart } from '@/lib/booking/validate-requested-start';
import { at, booking, context, haircut, rule, settings, timeOff } from './fixtures';

const base: Partial<SchedulingContext> = {
	rules: [rule('sam', 2, '09:00', '17:00')],
	service: haircut,
	timeOff: [timeOff('sam', '2026-03-10T16:00:00Z', '2026-03-10T17:00:00Z')],
	bookings: [booking('sam', '2026-03-10T18:00:00Z', '2026-03-10T18:40:00Z')],
	now: at('2026-03-01T12:00:00Z'),
};

const check = (startsAt: string, overrides: Partial<SchedulingContext> = {}, staffId = 'sam') =>
	validateRequestedStart({
		...context({ ...base, ...overrides }),
		staffId,
		startsAt: at(startsAt),
	});

describe('validateRequestedStart', () => {
	it('accepts a free, aligned start and returns the computed times', () => {
		const startsAt = at('2026-03-10T13:00:00Z');
		expect(check('2026-03-10T13:00:00Z')).toEqual({
			ok: true,
			value: computeBookingTimes({ startsAt, service: haircut }),
		});
	});

	it('accepts starts that touch closing, time off and the next booking edges', () => {
		expect(check('2026-03-10T20:15:00Z').ok).toBe(true);
		expect(check('2026-03-10T17:00:00Z').ok).toBe(true);
		expect(check('2026-03-10T17:15:00Z').ok).toBe(true);
	});

	it.each([
		['misaligned', '2026-03-10T13:05:00Z', {}],
		['misaligned', '2026-03-10T13:00:30Z', {}],
		['too_soon', '2026-03-10T13:00:00Z', { now: at('2026-03-10T11:30:00Z') }],
		['too_far', '2026-03-10T13:00:00Z', { settings: settings({ maxHorizonDays: 5 }) }],
		['outside_hours', '2026-03-10T12:45:00Z', {}],
		['outside_hours', '2026-03-10T20:30:00Z', {}],
		['outside_hours', '2026-03-11T13:00:00Z', {}],
		['time_off', '2026-03-10T15:30:00Z', {}],
		['conflict', '2026-03-10T17:30:00Z', {}],
		['conflict', '2026-03-10T18:30:00Z', {}],
	] as const)('rejects with %s (%s)', (reason, startsAt, overrides) => {
		expect(check(startsAt, overrides)).toEqual({ ok: false, error: reason });
	});

	it('reports the first failing reason in a fixed order', () => {
		expect(check('2026-03-10T12:05:00Z', { now: at('2026-03-10T12:00:00Z') })).toEqual({
			ok: false,
			error: 'misaligned',
		});
		expect(check('2026-03-10T16:00:00Z', { now: at('2026-03-10T15:00:00Z') })).toEqual({
			ok: false,
			error: 'too_soon',
		});
	});

	it('treats a staff member without rules as outside hours', () => {
		expect(check('2026-03-10T13:00:00Z', {}, 'alex')).toEqual({
			ok: false,
			error: 'outside_hours',
		});
	});

	it('applies the staff duration override', () => {
		expect(check('2026-03-10T20:15:00Z', { durationOverrideMinutesByStaff: { sam: 60 } })).toEqual({
			ok: false,
			error: 'outside_hours',
		});
		expect(check('2026-03-10T20:15:00Z', { durationOverrideMinutesByStaff: { alex: 60 } }).ok).toBe(
			true,
		);
	});
});

describe('validateStaffStart', () => {
	const staffCheck = (
		startsAt: string,
		overrides: Partial<SchedulingContext> = {},
		override = false,
	) =>
		validateStaffStart({
			...context({ ...base, ...overrides }),
			staffId: 'sam',
			startsAt: at(startsAt),
			overrideHours: override,
		});

	it('ignores lead time, horizon and slot step, so past and off-step walk-ins fit', () => {
		const now = { now: at('2026-03-10T14:20:00Z') };
		expect(staffCheck('2026-03-10T14:07:00Z', now).ok).toBe(true);
		expect(
			staffCheck('2026-03-10T13:00:00Z', { settings: settings({ maxHorizonDays: 0 }) }).ok,
		).toBe(true);
	});

	it.each([
		['misaligned', '2026-03-10T13:00:30Z'],
		['outside_hours', '2026-03-10T20:30:00Z'],
		['time_off', '2026-03-10T15:30:00Z'],
		['conflict', '2026-03-10T17:45:00Z'],
	] as const)('still rejects with %s (%s)', (reason, startsAt) => {
		expect(staffCheck(startsAt)).toEqual({ ok: false, error: reason });
	});

	it('lets an override skip hours and time off but never an overlap', () => {
		expect(staffCheck('2026-03-10T22:00:00Z', {}, true).ok).toBe(true);
		expect(staffCheck('2026-03-10T16:00:00Z', {}, true).ok).toBe(true);
		expect(staffCheck('2026-03-10T17:30:00Z', {}, true)).toEqual({ ok: false, error: 'conflict' });
		expect(staffCheck('2026-03-10T17:20:00Z', {}, true).ok).toBe(true);
	});
});
