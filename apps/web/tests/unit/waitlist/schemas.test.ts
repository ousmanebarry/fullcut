import { describe, expect, it } from 'vitest';
import { leaveBodySchema, waitlistBodySchema } from '@/lib/waitlist/schemas';
import { buildWindows, describeWindows } from '@/lib/waitlist/types';

const valid = {
	serviceId: '3f2b1c3e-8a52-4c35-9a4f-0e5d2b6f9a11',
	staffId: 'any',
	earliestDate: '2030-01-01',
	latestDate: '2030-01-10',
	name: ' Wendy Waitlist ',
	phone: '(416) 555-0123',
	offersRequested: true,
};

describe('waitlistBodySchema', () => {
	it('accepts a minimal body and defaults to any time', () => {
		const parsed = waitlistBodySchema.parse(valid);
		expect(parsed.timeWindows).toEqual([]);
		expect(parsed.name).toBe('Wendy Waitlist');
	});

	it('requires the box to be ticked', () => {
		expect(waitlistBodySchema.safeParse({ ...valid, offersRequested: false }).success).toBe(false);
		expect(waitlistBodySchema.safeParse({ ...valid, offersRequested: undefined }).success).toBe(
			false,
		);
	});

	it('requires the last date not to precede the first', () => {
		const result = waitlistBodySchema.safeParse({ ...valid, latestDate: '2029-12-31' });
		expect(result.success).toBe(false);
		expect(waitlistBodySchema.safeParse({ ...valid, latestDate: '2030-01-01' }).success).toBe(true);
	});

	it('rejects impossible dates', () => {
		expect(waitlistBodySchema.safeParse({ ...valid, earliestDate: '2030-02-30' }).success).toBe(
			false,
		);
	});

	it('validates time windows', () => {
		const window = { weekday: 2, start: '09:00', end: '12:00' };
		expect(waitlistBodySchema.safeParse({ ...valid, timeWindows: [window] }).success).toBe(true);
		for (const bad of [
			{ ...window, weekday: 7 },
			{ ...window, start: '9:00' },
			{ ...window, start: '12:00', end: '09:00' },
			{ ...window, end: '09:00' },
		]) {
			expect(waitlistBodySchema.safeParse({ ...valid, timeWindows: [bad] }).success).toBe(false);
		}
	});

	it('allows at most 14 windows', () => {
		const window = { weekday: 2, start: '09:00', end: '12:00' };
		const many = (n: number) => Array.from({ length: n }, () => window);
		expect(waitlistBodySchema.safeParse({ ...valid, timeWindows: many(14) }).success).toBe(true);
		expect(waitlistBodySchema.safeParse({ ...valid, timeWindows: many(15) }).success).toBe(false);
	});

	it('accepts a specific stylist id but not free text', () => {
		const staff = '9b1c4a52-0f6e-4d0c-8a33-1f7d5c0e2b44';
		expect(waitlistBodySchema.safeParse({ ...valid, staffId: staff }).success).toBe(true);
		expect(waitlistBodySchema.safeParse({ ...valid, staffId: 'anyone' }).success).toBe(false);
	});
});

describe('leaveBodySchema', () => {
	it('accepts only well-formed tokens', () => {
		expect(leaveBodySchema.safeParse({ token: 'a'.repeat(43) }).success).toBe(true);
		expect(leaveBodySchema.safeParse({ token: 'short' }).success).toBe(false);
		expect(leaveBodySchema.safeParse({ token: 'a'.repeat(42) + '!' }).success).toBe(false);
	});
});

describe('buildWindows', () => {
	it('means any time when nothing is chosen', () => {
		expect(buildWindows([], [])).toEqual([]);
	});

	it('covers the whole day on the chosen weekdays', () => {
		expect(buildWindows([6, 2], [])).toEqual([
			{ weekday: 2, start: '00:00', end: '23:59' },
			{ weekday: 6, start: '00:00', end: '23:59' },
		]);
	});

	it('applies chosen times of day to every weekday', () => {
		const windows = buildWindows([], ['evening']);
		expect(windows).toHaveLength(7);
		expect(windows[0]).toEqual({ weekday: 0, start: '17:00', end: '21:00' });
	});

	it('merges adjacent times of day into one range', () => {
		expect(buildWindows([1], ['afternoon', 'morning'])).toEqual([
			{ weekday: 1, start: '09:00', end: '17:00' },
		]);
	});

	it('keeps separate ranges for times that do not touch', () => {
		expect(buildWindows([1], ['morning', 'evening'])).toEqual([
			{ weekday: 1, start: '09:00', end: '12:00' },
			{ weekday: 1, start: '17:00', end: '21:00' },
		]);
	});

	it('never exceeds what the database accepts', () => {
		expect(buildWindows([0, 1, 2, 3, 4, 5, 6], ['morning', 'evening']).length).toBeLessThanOrEqual(
			14,
		);
	});

	it('produces windows the schema accepts', () => {
		const windows = buildWindows([1, 3], ['morning', 'afternoon', 'evening']);
		expect(waitlistBodySchema.safeParse({ ...valid, timeWindows: windows }).success).toBe(true);
	});
});

describe('describeWindows', () => {
	it('describes any time and specific windows', () => {
		expect(describeWindows([])).toBe('Any time');
		expect(describeWindows([{ weekday: 2, start: '09:00', end: '12:00' }])).toBe('Tue 09:00-12:00');
	});
});
