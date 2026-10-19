import { describe, expect, it } from 'vitest';
import { computeBookingTimes } from '@/lib/booking/compute-booking-times';
import { generateSlots } from '@/lib/booking/generate-slots';
import type { SchedulingContext, Slot, StaffId } from '@/lib/booking/types';
import { instantToIso, localDate, localDateOf, timeZone } from '@/lib/time';
import {
	at,
	booking,
	context,
	haircut,
	quick,
	rule,
	settings,
	timeOff,
	toronto,
	vancouver,
} from './fixtures';

const TUE = '2026-03-10';

function run(
	overrides: Partial<SchedulingContext>,
	staffIds: readonly StaffId[] = ['sam'],
	from: string = TUE,
	to: string = from,
): Slot[] {
	return generateSlots({
		...context(overrides),
		staffIds,
		range: { from: localDate(from), to: localDate(to) },
	});
}

const isos = (slots: readonly Slot[]) => slots.map((s) => instantToIso(s.startsAt));
const times = (slots: readonly Slot[]) => slots.map((s) => s.localLabel.split(', ').at(-1));
const quarterHoursFrom = (startIso: string, count: number) =>
	Array.from({ length: count }, (_, i) =>
		new Date(Date.parse(startIso) + i * 15 * 60_000).toISOString(),
	);

const workday = [rule('sam', 2, '09:00', '17:00')];

describe('generateSlots: normal weekday (Toronto, UTC-4)', () => {
	it('starts at opening and keeps service + buffer inside closing', () => {
		const slots = run({ rules: workday, service: haircut });
		expect(slots).toHaveLength(30);
		expect(slots[0]).toEqual({
			startsAt: at('2026-03-10T13:00:00Z'),
			staffId: 'sam',
			localLabel: 'Tue, Mar 10, 9:00 AM',
		});
		expect(times(slots).at(-1)).toBe('4:15 PM');
	});

	it('lets the last service end exactly at closing when there is no buffer', () => {
		const slots = run({ rules: workday, service: quick });
		expect(slots).toHaveLength(31);
		const last = slots.at(-1);
		expect(
			last && instantToIso(computeBookingTimes({ startsAt: last.startsAt, service: quick }).endsAt),
		).toBe('2026-03-10T21:00:00.000Z');
	});

	it("respects an existing booking's buffer", () => {
		const slots = run({
			rules: workday,
			service: haircut,
			bookings: [booking('sam', '2026-03-10T14:00:00Z', '2026-03-10T14:40:00Z')],
		});
		expect(times(slots).slice(0, 3)).toEqual(['9:00 AM', '9:15 AM', '10:45 AM']);
	});

	it('allows back-to-back bookings on both sides', () => {
		const slots = times(
			run({
				rules: workday,
				bookings: [booking('sam', '2026-03-10T14:00:00Z', '2026-03-10T14:30:00Z')],
			}),
		);
		expect(slots).toContain('9:30 AM');
		expect(slots).toContain('10:30 AM');
		expect(slots).not.toContain('9:45 AM');
		expect(slots).not.toContain('10:00 AM');
		expect(slots).not.toContain('10:15 AM');
	});

	it('handles bookings at the very start and end of the window', () => {
		const slots = times(
			run({
				rules: workday,
				bookings: [
					booking('sam', '2026-03-10T13:00:00Z', '2026-03-10T13:30:00Z'),
					booking('sam', '2026-03-10T20:30:00Z', '2026-03-10T21:00:00Z'),
				],
			}),
		);
		expect(slots[0]).toBe('9:30 AM');
		expect(slots.at(-1)).toBe('4:00 PM');
	});

	it("ignores other staff members' bookings", () => {
		const slots = run({
			rules: workday,
			bookings: [booking('alex', '2026-03-10T13:00:00Z', '2026-03-10T21:00:00Z')],
		});
		expect(slots).toHaveLength(31);
	});
});

describe('generateSlots: time off', () => {
	it('splits the day around time off', () => {
		const slots = times(
			run({
				rules: workday,
				timeOff: [timeOff('sam', '2026-03-10T16:00:00Z', '2026-03-10T17:00:00Z')],
			}),
		);
		expect(slots).toHaveLength(26);
		expect(slots).toContain('11:30 AM');
		expect(slots).toContain('1:00 PM');
		for (const blocked of ['11:45 AM', '12:00 PM', '12:30 PM', '12:45 PM'])
			expect(slots).not.toContain(blocked);
	});

	it('removes the whole day for a full-day absence', () => {
		expect(
			run({
				rules: workday,
				timeOff: [timeOff('sam', '2026-03-10T04:00:00Z', '2026-03-11T04:00:00Z')],
			}),
		).toEqual([]);
	});
});

describe('generateSlots: lead time and horizon', () => {
	it('drops starts before now + lead time', () => {
		const slots = run({ rules: workday, now: at('2026-03-10T13:50:00Z') });
		expect(times(slots)[0]).toBe('12:00 PM');
	});

	it('keeps a start exactly at now + lead time', () => {
		const slots = run({ rules: workday, now: at('2026-03-10T13:00:00Z') });
		expect(times(slots)[0]).toBe('11:00 AM');
	});

	it('drops starts after now + horizon days (boundary inclusive)', () => {
		const slots = run(
			{
				rules: workday,
				settings: settings({ minLeadMinutes: 0, maxHorizonDays: 7 }),
				now: at('2026-03-10T13:00:00Z'),
			},
			['sam'],
			'2026-03-10',
			'2026-03-24',
		);
		expect(slots).toHaveLength(32);
		expect(isos(slots.slice(0, 1))).toEqual(['2026-03-10T13:00:00.000Z']);
		expect(isos(slots.slice(-2))).toEqual(['2026-03-10T20:30:00.000Z', '2026-03-17T13:00:00.000Z']);
	});
});

describe('generateSlots: fitting', () => {
	it('returns no slots when the service is longer than the window', () => {
		expect(
			run({
				rules: [rule('sam', 2, '09:00', '10:00')],
				service: { durationMinutes: 90, bufferMinutes: 0 },
			}),
		).toEqual([]);
	});

	it('returns no slots when the service is longer than every gap', () => {
		const slots = run({
			rules: [rule('sam', 2, '09:00', '11:00')],
			service: { durationMinutes: 60, bufferMinutes: 0 },
			bookings: [booking('sam', '2026-03-10T13:45:00Z', '2026-03-10T14:15:00Z')],
		});
		expect(slots).toEqual([]);
	});

	it('aligns starts to the local clock when the window does not start on the step', () => {
		const slots = run({
			rules: [rule('sam', 2, '09:10', '10:00')],
			service: { durationMinutes: 15, bufferMinutes: 0 },
		});
		expect(times(slots)).toEqual(['9:15 AM', '9:30 AM', '9:45 AM']);
	});

	it('treats touching or overlapping rules on one day as a single window', () => {
		for (const rules of [
			[rule('sam', 2, '09:00', '12:00'), rule('sam', 2, '12:00', '13:00')],
			[rule('sam', 2, '09:00', '12:00'), rule('sam', 2, '11:00', '13:00')],
		]) {
			const slots = times(run({ rules }));
			expect(slots).toContain('11:45 AM');
			expect(slots.at(-1)).toBe('12:30 PM');
		}
	});

	it('uses a per-staff duration override only for that staff member', () => {
		const rules = [rule('sam', 2, '09:00', '10:00'), rule('alex', 2, '09:00', '10:00')];
		const durationOverrideMinutesByStaff = { sam: 60 };
		expect(times(run({ rules, durationOverrideMinutesByStaff }, ['sam']))).toEqual(['9:00 AM']);
		expect(times(run({ rules, durationOverrideMinutesByStaff }, ['alex']))).toEqual([
			'9:00 AM',
			'9:15 AM',
			'9:30 AM',
		]);
	});

	it('rejects a non-positive slot step', () => {
		expect(() => run({ rules: workday, settings: settings({ slotStepMinutes: 0 }) })).toThrow();
	});
});

describe('generateSlots: any staff', () => {
	const rules = [
		rule('alex', 2, '09:00', '17:00'),
		rule('sam', 2, '09:00', '17:00'),
		rule('alex', 3, '09:00', '17:00'),
		rule('sam', 3, '09:00', '17:00'),
	];
	const bookings = [
		booking('alex', '2026-03-10T13:00:00Z', '2026-03-10T13:30:00Z'),
		booking('alex', '2026-03-10T19:00:00Z', '2026-03-10T19:30:00Z'),
		booking('sam', '2026-03-10T17:00:00Z', '2026-03-10T17:30:00Z'),
	];

	it('returns one slot per start time, choosing whoever is free', () => {
		const slots = run({ rules, bookings }, ['alex', 'sam']);
		expect(slots).toHaveLength(31);
		expect(new Set(isos(slots)).size).toBe(31);
		const staffAt = (iso: string) => slots.find((s) => instantToIso(s.startsAt) === iso)?.staffId;
		expect(staffAt('2026-03-10T13:00:00.000Z')).toBe('sam');
		expect(staffAt('2026-03-10T17:00:00.000Z')).toBe('alex');
		expect(staffAt('2026-03-10T19:00:00.000Z')).toBe('sam');
	});

	it('prefers the staff member with the fewest bookings that day', () => {
		const slots = run({ rules, bookings }, ['alex', 'sam']);
		const tenAm = slots.find((s) => instantToIso(s.startsAt) === '2026-03-10T14:00:00.000Z');
		expect(tenAm?.staffId).toBe('sam');
	});

	it('breaks ties by the order of staffIds, ignoring bookings on other days', () => {
		const wed = '2026-03-11';
		expect(new Set(run({ rules, bookings }, ['alex', 'sam'], wed).map((s) => s.staffId))).toEqual(
			new Set(['alex']),
		);
		expect(new Set(run({ rules, bookings }, ['sam', 'alex'], wed).map((s) => s.staffId))).toEqual(
			new Set(['sam']),
		);
	});

	it('returns slots sorted by time across days and staff', () => {
		const slots = run({ rules, bookings }, ['alex', 'sam'], '2026-03-10', '2026-03-11');
		const starts = slots.map((s) => s.startsAt);
		expect(starts).toEqual([...starts].sort((a, b) => a - b));
	});
});

describe('generateSlots: DST in America/Toronto', () => {
	const fifteen = { durationMinutes: 15, bufferMinutes: 0 };

	it('spring forward (2026-03-08): skips 02:xx with no gaps in real time', () => {
		const slots = run(
			{ rules: [rule('sam', 0, '00:00', '04:00')], service: fifteen },
			['sam'],
			'2026-03-08',
		);
		expect(isos(slots)).toEqual(quarterHoursFrom('2026-03-08T05:00:00.000Z', 12));
		// prettier-ignore
		expect(times(slots)).toEqual([
			'12:00 AM', '12:15 AM', '12:30 AM', '12:45 AM',
			'1:00 AM', '1:15 AM', '1:30 AM', '1:45 AM',
			'3:00 AM', '3:15 AM', '3:30 AM', '3:45 AM',
		]);
	});

	it('fall back (2026-11-01): offers the repeated hour twice with distinct labels', () => {
		const slots = run(
			{
				rules: [rule('sam', 0, '00:00', '04:00')],
				service: fifteen,
				now: at('2026-10-25T00:00:00Z'),
			},
			['sam'],
			'2026-11-01',
		);
		expect(isos(slots)).toEqual(quarterHoursFrom('2026-11-01T04:00:00.000Z', 20));
		// prettier-ignore
		expect(times(slots)).toEqual([
			'12:00 AM', '12:15 AM', '12:30 AM', '12:45 AM',
			'1:00 AM EDT', '1:15 AM EDT', '1:30 AM EDT', '1:45 AM EDT',
			'1:00 AM EST', '1:15 AM EST', '1:30 AM EST', '1:45 AM EST',
			'2:00 AM', '2:15 AM', '2:30 AM', '2:45 AM',
			'3:00 AM', '3:15 AM', '3:30 AM', '3:45 AM',
		]);
		expect(new Set(slots.map((s) => s.localLabel)).size).toBe(20);
	});

	function firstAndLastByDate(slots: readonly Slot[]) {
		const byDate: Record<string, string[]> = {};
		for (const s of slots)
			(byDate[localDateOf(s.startsAt, toronto)] ??= []).push(instantToIso(s.startsAt));
		return Object.fromEntries(
			Object.entries(byDate).map(([d, list]) => [d, [list[0], list.at(-1)]]),
		);
	}

	it('shifts 09:00-17:00 from UTC-5 to UTC-4 across spring forward', () => {
		const rules = [rule('sam', 6, '09:00', '17:00'), rule('sam', 1, '09:00', '17:00')];
		const slots = run(
			{ rules, now: at('2026-03-01T00:00:00Z') },
			['sam'],
			'2026-03-07',
			'2026-03-09',
		);
		expect(firstAndLastByDate(slots)).toEqual({
			'2026-03-07': ['2026-03-07T14:00:00.000Z', '2026-03-07T21:30:00.000Z'],
			'2026-03-09': ['2026-03-09T13:00:00.000Z', '2026-03-09T20:30:00.000Z'],
		});
	});

	it('shifts 09:00-17:00 from UTC-4 to UTC-5 across fall back', () => {
		const rules = [rule('sam', 6, '09:00', '17:00'), rule('sam', 1, '09:00', '17:00')];
		const slots = run(
			{ rules, now: at('2026-10-25T00:00:00Z') },
			['sam'],
			'2026-10-31',
			'2026-11-02',
		);
		expect(firstAndLastByDate(slots)).toEqual({
			'2026-10-31': ['2026-10-31T13:00:00.000Z', '2026-10-31T20:30:00.000Z'],
			'2026-11-02': ['2026-11-02T14:00:00.000Z', '2026-11-02T21:30:00.000Z'],
		});
	});
});

describe('generateSlots: other timezones', () => {
	it('America/Vancouver spring forward (UTC-8 -> UTC-7)', () => {
		const slots = run(
			{
				rules: [rule('sam', 0, '00:00', '04:00'), rule('sam', 1, '09:00', '10:00')],
				settings: settings({ timezone: vancouver }),
				service: { durationMinutes: 15, bufferMinutes: 0 },
			},
			['sam'],
			'2026-03-08',
			'2026-03-09',
		);
		expect(isos(slots)).toEqual([
			...quarterHoursFrom('2026-03-08T08:00:00.000Z', 12),
			...quarterHoursFrom('2026-03-09T16:00:00.000Z', 4),
		]);
		expect(times(slots).some((t) => t?.startsWith('2:'))).toBe(false);
	});

	it('aligns to the local clock in a half-hour offset zone (Asia/Kolkata)', () => {
		const slots = run({
			rules: [rule('sam', 2, '09:00', '10:00')],
			settings: settings({ timezone: timeZone('Asia/Kolkata') }),
		});
		expect(isos(slots)).toEqual(quarterHoursFrom('2026-03-10T03:30:00.000Z', 3));
		expect(times(slots)).toEqual(['9:00 AM', '9:15 AM', '9:30 AM']);
	});
});
