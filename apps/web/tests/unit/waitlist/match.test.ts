import { describe, expect, it } from 'vitest';
import type { Service } from '@/lib/booking/types';
import { localDate, type Instant } from '@/lib/time';
import {
	entryCoversStart,
	matchWaitlist,
	offerKey,
	type MatchEntry,
	type MatchInput,
} from '@/lib/waitlist/match';
import { at, booking, rule, settings, toronto } from '../booking/fixtures';

// Tuesday 2026-10-27 in Toronto is EDT (UTC-4). Sam works Tue 09:00-17:00 and is booked
// 14:00-15:00 and 16:00-17:00, so cancelling 15:00-16:00 leaves exactly that hour free.
const SAM = 'sam';
const ALEX = 'alex';
const short: Service = { durationMinutes: 30, bufferMinutes: 0 };
const hour: Service = { durationMinutes: 60, bufferMinutes: 0 };
const long: Service = { durationMinutes: 90, bufferMinutes: 0 };
const services = new Map<string, Service>([
	['short', short],
	['hour', hour],
	['long', long],
]);

let entryCounter = 0;
function entry(overrides: Partial<MatchEntry> = {}): MatchEntry {
	entryCounter++;
	return {
		id: `entry-${entryCounter}`,
		clientId: `client-${entryCounter}`,
		serviceId: 'short',
		staffId: null,
		earliestDate: localDate('2026-10-20'),
		latestDate: localDate('2026-10-31'),
		timeWindows: [],
		createdAt: at('2026-10-01T12:00:00Z'),
		smsOptedOut: false,
		hasPhone: true,
		hasOpenOffer: false,
		...overrides,
	};
}

function input(overrides: Partial<MatchInput> = {}): MatchInput {
	const now = overrides.now ?? at('2026-10-26T12:00:00Z');
	return {
		freedSlot: {
			staffId: SAM,
			startsAt: at('2026-10-27T19:00:00Z'),
			endsAt: at('2026-10-27T20:00:00Z'),
		},
		entries: [],
		scheduling: {
			settings: settings(),
			rules: [rule(SAM, 2, '09:00', '17:00'), rule(ALEX, 2, '09:00', '17:00')],
			timeOff: [],
			bookings: [
				booking(SAM, '2026-10-27T18:00:00Z', '2026-10-27T19:00:00Z'),
				booking(SAM, '2026-10-27T20:00:00Z', '2026-10-27T21:00:00Z'),
			],
			now,
		},
		services,
		bookedThatDay: new Set(),
		atBookingLimit: new Set(),
		previousOffers: new Set(),
		offeredEntries: new Set(),
		minNoticeMinutes: 60,
		now,
		...overrides,
	};
}

const ids = (candidates: { entryId: string }[]) => candidates.map((c) => c.entryId);

describe('matchWaitlist: what fits', () => {
	it('offers the freed start for a service that fits', () => {
		const e = entry();
		const [candidate, ...rest] = matchWaitlist(input({ entries: [e] }));
		expect(rest).toHaveLength(0);
		expect(candidate).toEqual({
			entryId: e.id,
			clientId: e.clientId,
			serviceId: 'short',
			staffId: SAM,
			startsAt: at('2026-10-27T19:00:00Z'),
			endsAt: at('2026-10-27T19:30:00Z'),
			blockedUntil: at('2026-10-27T19:30:00Z'),
		});
	});

	it('a shorter service fits a longer freed gap, an equal one fits, a longer one never does', () => {
		const shortEntry = entry({ serviceId: 'short' });
		const hourEntry = entry({ serviceId: 'hour' });
		const longEntry = entry({ serviceId: 'long' });
		expect(ids(matchWaitlist(input({ entries: [shortEntry, hourEntry, longEntry] })))).toEqual([
			shortEntry.id,
			hourEntry.id,
		]);
	});

	it('skips services that no longer exist', () => {
		expect(matchWaitlist(input({ entries: [entry({ serviceId: 'retired' })] }))).toEqual([]);
	});

	it('only matches the freed staff member, or entries that take anyone', () => {
		const forSam = entry({ staffId: SAM });
		const forAlex = entry({ staffId: ALEX });
		const anyone = entry();
		expect(ids(matchWaitlist(input({ entries: [forAlex, anyone, forSam] })))).toEqual([
			forSam.id,
			anyone.id,
		]);
	});

	it('never offers time another booking now occupies', () => {
		const e = entry({ serviceId: 'hour' });
		const filled = input({ entries: [e] });
		const result = matchWaitlist({
			...filled,
			scheduling: {
				...filled.scheduling,
				bookings: [
					...filled.scheduling.bookings,
					booking(SAM, '2026-10-27T19:00:00Z', '2026-10-27T19:30:00Z'),
				],
			},
		});
		expect(result).toEqual([]);
	});

	it('respects time off', () => {
		const base = input({ entries: [entry()] });
		expect(
			matchWaitlist({
				...base,
				scheduling: {
					...base.scheduling,
					timeOff: [
						{
							staffId: SAM,
							startsAt: at('2026-10-27T19:00:00Z'),
							endsAt: at('2026-10-27T20:00:00Z'),
						},
					],
				},
			}),
		).toEqual([]);
	});
});

describe('matchWaitlist: order', () => {
	it('puts specific-staff entries first, then the oldest entry', () => {
		const oldAny = entry({ createdAt: at('2026-09-01T00:00:00Z') });
		const newAny = entry({ createdAt: at('2026-10-10T00:00:00Z') });
		const newSpecific = entry({ staffId: SAM, createdAt: at('2026-10-15T00:00:00Z') });
		const oldSpecific = entry({ staffId: SAM, createdAt: at('2026-09-15T00:00:00Z') });
		expect(
			ids(matchWaitlist(input({ entries: [newAny, oldAny, newSpecific, oldSpecific] }))),
		).toEqual([oldSpecific.id, newSpecific.id, oldAny.id, newAny.id]);
	});

	it('offers each client at most once per slot', () => {
		const first = entry({ clientId: 'twice', createdAt: at('2026-09-01T00:00:00Z') });
		const second = entry({ clientId: 'twice', serviceId: 'hour' });
		expect(ids(matchWaitlist(input({ entries: [second, first] })))).toEqual([first.id]);
	});
});

describe('matchWaitlist: who is skipped', () => {
	it.each([
		['opted out of texts', { smsOptedOut: true }],
		['has no phone', { hasPhone: false }],
		['already has an open offer', { hasOpenOffer: true }],
	])('skips a client who %s', (_label, overrides) => {
		expect(matchWaitlist(input({ entries: [entry(overrides)] }))).toEqual([]);
	});

	it('gives the next wave to clients not offered this slot yet', () => {
		const offered = entry({ createdAt: at('2026-09-01T00:00:00Z') });
		const next = entry();
		expect(
			ids(
				matchWaitlist(input({ entries: [offered, next], offeredEntries: new Set([offered.id]) })),
			),
		).toEqual([next.id]);
	});

	it('skips a client who already has a booking with the shop that day', () => {
		const e = entry();
		expect(matchWaitlist(input({ entries: [e], bookedThatDay: new Set([e.clientId]) }))).toEqual(
			[],
		);
	});

	it('skips a client at the shop limit of upcoming bookings', () => {
		const e = entry();
		expect(matchWaitlist(input({ entries: [e], atBookingLimit: new Set([e.clientId]) }))).toEqual(
			[],
		);
	});

	it('never offers the same slot twice; the next start in the gap is fine', () => {
		const e = entry();
		const [candidate] = matchWaitlist(
			input({
				entries: [e],
				previousOffers: new Set([offerKey(e.id, SAM, at('2026-10-27T19:00:00Z'))]),
			}),
		);
		expect(candidate?.startsAt).toBe(at('2026-10-27T19:15:00Z'));
	});

	it('skips entries whose dates miss the slot', () => {
		const before = entry({ latestDate: localDate('2026-10-26') });
		const after = entry({ earliestDate: localDate('2026-10-28') });
		const onTheDay = entry({
			earliestDate: localDate('2026-10-27'),
			latestDate: localDate('2026-10-27'),
		});
		expect(ids(matchWaitlist(input({ entries: [before, after, onTheDay] })))).toEqual([
			onTheDay.id,
		]);
	});
});

describe('matchWaitlist: notice and lead time', () => {
	// 14:30 local on the day of the slot.
	const lateMorning = at('2026-10-27T18:30:00Z');
	const noLead = () => ({ ...settings(), minLeadMinutes: 0 });

	it('starts no sooner than the minimum notice allows', () => {
		const base = input({ entries: [entry()], now: lateMorning, minNoticeMinutes: 60 });
		const [candidate] = matchWaitlist({
			...base,
			scheduling: { ...base.scheduling, settings: noLead() },
		});
		expect(candidate?.startsAt).toBe(at('2026-10-27T19:30:00Z'));
	});

	it('offers nothing when the notice swallows the whole gap', () => {
		const base = input({ entries: [entry()], now: lateMorning, minNoticeMinutes: 90 });
		expect(
			matchWaitlist({ ...base, scheduling: { ...base.scheduling, settings: noLead() } }),
		).toEqual([]);
	});

	it("also respects the booking page's lead time", () => {
		// 13:30 local with the default 120 minute lead: 15:30 is the first bookable start.
		const [candidate] = matchWaitlist(
			input({ entries: [entry()], now: at('2026-10-27T17:30:00Z'), minNoticeMinutes: 15 }),
		);
		expect(candidate?.startsAt).toBe(at('2026-10-27T19:30:00Z'));
	});
});

describe('time windows', () => {
	const tuesday = { earliestDate: localDate('2026-10-20'), latestDate: localDate('2026-10-31') };
	const slot = at('2026-10-27T19:00:00Z'); // Tue 15:00 EDT

	it('any time when there are no windows', () => {
		expect(entryCoversStart({ ...tuesday, timeWindows: [] }, slot, toronto)).toBe(true);
	});

	it('matches on weekday and local start time, end exclusive', () => {
		const covers = (start: string, end: string, weekday = 2) =>
			entryCoversStart({ ...tuesday, timeWindows: [{ weekday, start, end }] }, slot, toronto);
		expect(covers('15:00', '16:00')).toBe(true);
		expect(covers('12:00', '15:00')).toBe(false);
		expect(covers('09:00', '12:00')).toBe(false);
		expect(covers('15:00', '16:00', 3)).toBe(false);
	});

	it('drops entries whose windows miss the freed slot', () => {
		const mornings = entry({ timeWindows: [{ weekday: 2, start: '09:00', end: '12:00' }] });
		const afternoons = entry({ timeWindows: [{ weekday: 2, start: '12:00', end: '17:00' }] });
		expect(ids(matchWaitlist(input({ entries: [mornings, afternoons] })))).toEqual([afternoons.id]);
	});

	describe('on DST days in America/Toronto', () => {
		const dates = (date: string) => ({
			earliestDate: localDate(date),
			latestDate: localDate(date),
		});
		const window = (start: string, end: string) => [{ weekday: 0, start, end }];

		it('spring forward (Sun Mar 8 2026): 10:00 EDT is 14:00Z', () => {
			const tenAm: Instant = at('2026-03-08T14:00:00Z');
			const day = dates('2026-03-08');
			expect(
				entryCoversStart({ ...day, timeWindows: window('10:00', '11:00') }, tenAm, toronto),
			).toBe(true);
			expect(
				entryCoversStart({ ...day, timeWindows: window('09:00', '10:00') }, tenAm, toronto),
			).toBe(false);
		});

		it('fall back (Sun Nov 1 2026): 10:00 EST is 15:00Z', () => {
			const tenAm: Instant = at('2026-11-01T15:00:00Z');
			const day = dates('2026-11-01');
			expect(
				entryCoversStart({ ...day, timeWindows: window('10:00', '11:00') }, tenAm, toronto),
			).toBe(true);
			expect(
				entryCoversStart({ ...day, timeWindows: window('11:00', '12:00') }, tenAm, toronto),
			).toBe(false);
		});

		it('matches a freed slot on the fall-back day by its local time', () => {
			const now = at('2026-10-30T12:00:00Z');
			const morning = entry({ ...dates('2026-11-01'), timeWindows: window('10:00', '11:00') });
			const result = matchWaitlist({
				...input({ now }),
				freedSlot: {
					staffId: SAM,
					startsAt: at('2026-11-01T15:00:00Z'),
					endsAt: at('2026-11-01T16:00:00Z'),
				},
				entries: [morning],
				scheduling: {
					settings: settings(),
					rules: [rule(SAM, 0, '09:00', '17:00')],
					timeOff: [],
					bookings: [],
					now,
				},
			});
			expect(result.map((c) => c.startsAt)).toEqual([at('2026-11-01T15:00:00Z')]);
		});
	});
});
