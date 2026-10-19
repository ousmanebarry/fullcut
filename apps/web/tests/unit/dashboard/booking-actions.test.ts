import { describe, expect, it } from 'vitest';
import { manualBookingSchema } from '@/lib/dashboard/schemas';
import { availableActions, needsOutcome } from '@/lib/dashboard/types';

const start = Date.UTC(2026, 2, 10, 14);
const end = start + 30 * 60_000;

describe('availableActions', () => {
	const confirmed = { status: 'confirmed' as const, startsAtMs: start, undoUntilMs: null };

	it('offers outcomes only once the appointment has started', () => {
		expect(availableActions(confirmed, start - 1)).toEqual(['edit', 'cancel']);
		expect(availableActions(confirmed, start)).toEqual([
			'markCompleted',
			'markNoShow',
			'edit',
			'cancel',
		]);
	});

	it('offers undo until the end of the marking day', () => {
		const completed = { status: 'completed' as const, startsAtMs: start, undoUntilMs: end };
		expect(availableActions(completed, end - 1)).toEqual(['undoOutcome']);
		expect(availableActions(completed, end)).toEqual([]);
	});

	it('offers nothing for cancelled bookings', () => {
		expect(availableActions({ ...confirmed, status: 'cancelled' }, end)).toEqual([]);
	});
});

describe('needsOutcome', () => {
	it('is true for confirmed bookings after their end', () => {
		expect(needsOutcome({ status: 'confirmed', endsAtMs: end }, end - 1)).toBe(false);
		expect(needsOutcome({ status: 'confirmed', endsAtMs: end }, end)).toBe(true);
		expect(needsOutcome({ status: 'completed', endsAtMs: end }, end)).toBe(false);
	});
});

describe('manualBookingSchema', () => {
	const base = {
		serviceId: '00000000-0000-0000-0000-000000000001',
		staffId: '00000000-0000-0000-0000-000000000002',
		date: '2026-03-10',
		time: '09:30',
	};
	const errorsFor = (input: object) => {
		const result = manualBookingSchema.safeParse({ ...base, ...input });
		return result.success ? [] : result.error.issues.map((i) => i.path.join('.'));
	};

	it('needs a phone number for a new client booked by phone', () => {
		expect(errorsFor({ source: 'phone', clientName: 'Pat' })).toEqual(['phone']);
		expect(errorsFor({ source: 'phone', clientName: 'Pat', phone: '555 123 4567' })).toEqual([]);
	});

	it('lets a walk-in skip the phone but not the name', () => {
		expect(errorsFor({ source: 'walk_in', clientName: 'Pat' })).toEqual([]);
		expect(errorsFor({ source: 'walk_in', clientName: '  ' })).toEqual(['clientName']);
	});

	it('needs neither for a picked client', () => {
		expect(
			errorsFor({ source: 'phone', clientId: '00000000-0000-0000-0000-000000000003' }),
		).toEqual([]);
	});

	it('rejects other sources and bad times', () => {
		expect(errorsFor({ source: 'direct', clientName: 'Pat' })).toEqual(['source']);
		expect(errorsFor({ source: 'walk_in', clientName: 'Pat', time: '25:00' })).toEqual(['time']);
	});
});
