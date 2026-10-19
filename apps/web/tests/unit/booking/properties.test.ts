import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { computeBookingTimes } from '@/lib/booking/compute-booking-times';
import { generateSlots, type GenerateSlotsInput } from '@/lib/booking/generate-slots';
import type { StaffId } from '@/lib/booking/types';
import { validateRequestedStart } from '@/lib/booking/validate-requested-start';
import { addMinutes, localDate, localTime, weekdayOf, zonedToInstant } from '@/lib/time';
import { settings, toronto } from './fixtures';

const STAFF: StaffId[] = ['a', 'b'];
const DATES = ['2026-03-07', '2026-03-08', '2026-03-10', '2026-11-01'] as const;

const hhmm = (m: number) =>
	localTime(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);

const fiveMinutes = (min: number, max: number) =>
	fc.integer({ min: min / 5, max: max / 5 }).map((n) => n * 5);

const ruleArb = fc
	.record({
		staffId: fc.constantFrom(...STAFF),
		start: fiveMinutes(0, 1380),
		length: fiveMinutes(15, 600),
	})
	.map(({ staffId, start, length }) => ({
		staffId,
		startMinute: start,
		endMinute: Math.min(start + length, 1440),
	}));

const blockArb = fc.record({
	staffId: fc.constantFrom(...STAFF),
	offset: fc.integer({ min: -120, max: 1500 }),
	length: fc.integer({ min: 1, max: 180 }),
});

const scenarioArb = fc
	.record({
		date: fc.constantFrom(...DATES),
		rules: fc.array(ruleArb, { minLength: 1, maxLength: 4 }),
		bookings: fc.array(blockArb, { maxLength: 6 }),
		timeOff: fc.array(blockArb, { maxLength: 2 }),
		durationMinutes: fiveMinutes(5, 120),
		bufferMinutes: fiveMinutes(0, 30),
		slotStepMinutes: fc.constantFrom(5, 10, 15, 30),
		minLeadMinutes: fc.integer({ min: 0, max: 240 }),
		maxHorizonDays: fc.integer({ min: 0, max: 3 }),
		nowOffsetMinutes: fc.integer({ min: -3000, max: 720 }),
		overrideA: fc.option(fiveMinutes(5, 120), { nil: undefined }),
		staffIds: fc.constantFrom<StaffId[]>(['a'], ['b'], ['a', 'b'], ['b', 'a']),
	})
	.map((s): GenerateSlotsInput => {
		const date = localDate(s.date);
		const midnight = zonedToInstant(date, 0, toronto);
		const weekday = weekdayOf(date);
		return {
			settings: settings({
				slotStepMinutes: s.slotStepMinutes,
				minLeadMinutes: s.minLeadMinutes,
				maxHorizonDays: s.maxHorizonDays,
			}),
			service: { durationMinutes: s.durationMinutes, bufferMinutes: s.bufferMinutes },
			staffIds: s.staffIds,
			rules: s.rules.map((r) => ({
				staffId: r.staffId,
				weekday,
				startTime: hhmm(r.startMinute),
				endTime: hhmm(r.endMinute),
			})),
			bookings: s.bookings.map((b) => ({
				staffId: b.staffId,
				startsAt: addMinutes(midnight, b.offset),
				blockedUntil: addMinutes(midnight, b.offset + b.length),
			})),
			timeOff: s.timeOff.map((t) => ({
				staffId: t.staffId,
				startsAt: addMinutes(midnight, t.offset),
				endsAt: addMinutes(midnight, t.offset + t.length),
			})),
			now: addMinutes(midnight, s.nowOffsetMinutes),
			range: { from: date, to: date },
			durationOverrideMinutesByStaff: s.overrideA === undefined ? undefined : { a: s.overrideA },
		};
	});

const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) =>
	aStart < bEnd && bStart < aEnd;

describe('generateSlots properties', () => {
	it('never overlaps bookings or time off and is sorted and unique', () => {
		fc.assert(
			fc.property(scenarioArb, (input) => {
				const slots = generateSlots(input);
				for (const [i, slot] of slots.entries()) {
					const prev = slots[i - 1];
					if (prev) expect(prev.startsAt).toBeLessThan(slot.startsAt);
					expect(input.staffIds).toContain(slot.staffId);
					const { blockedUntil } = computeBookingTimes({
						startsAt: slot.startsAt,
						service: input.service,
						durationOverrideMinutes: input.durationOverrideMinutesByStaff?.[slot.staffId],
					});
					const busy = [
						...input.bookings.map((b) => [b.staffId, b.startsAt, b.blockedUntil] as const),
						...input.timeOff.map((t) => [t.staffId, t.startsAt, t.endsAt] as const),
					];
					for (const [staffId, start, end] of busy) {
						if (staffId === slot.staffId)
							expect(overlaps(slot.startsAt, blockedUntil, start, end)).toBe(false);
					}
				}
			}),
			{ numRuns: 300 },
		);
	});

	it('agrees with validateRequestedStart in both directions for a single staff member', () => {
		fc.assert(
			fc.property(scenarioArb, (raw) => {
				const input = { ...raw, staffIds: ['a'] };
				const offered = new Set<number>(generateSlots(input).map((s) => s.startsAt));
				const dayEnd = zonedToInstant(input.range.from, 1440, toronto);
				for (
					let t = zonedToInstant(input.range.from, 0, toronto);
					t < dayEnd;
					t = addMinutes(t, 5)
				) {
					expect(validateRequestedStart({ ...input, staffId: 'a', startsAt: t }).ok).toBe(
						offered.has(t),
					);
				}
			}),
			{ numRuns: 100 },
		);
	});
});
