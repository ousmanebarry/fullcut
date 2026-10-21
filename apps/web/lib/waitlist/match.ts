// Pure waitlist matching: which waitlisted clients to offer a freed slot, and at what exact time.
import { generateSlots } from '@/lib/booking/generate-slots';
import type { SchedulingContext, Service, StaffId } from '@/lib/booking/types';
import { computeBookingTimes } from '@/lib/booking/compute-booking-times';
import {
	addMinutes,
	daysBetween,
	localDateOf,
	localMinuteOfDay,
	weekdayOf,
	type Instant,
	type LocalDate,
	type TimeZone,
} from '@/lib/time';
import type { TimeWindow } from './types';

export interface FreedSlot {
	staffId: StaffId;
	startsAt: Instant;
	/** End of the freed time (the old booking's blocked_until). */
	endsAt: Instant;
}

export interface MatchEntry {
	id: string;
	clientId: string;
	serviceId: string;
	/** null = any staff. */
	staffId: StaffId | null;
	earliestDate: LocalDate;
	latestDate: LocalDate;
	timeWindows: readonly TimeWindow[];
	createdAt: Instant;
	smsOptedOut: boolean;
	hasPhone: boolean;
	/** The client already has an open (unexpired) offer. */
	hasOpenOffer: boolean;
}

export interface MatchInput {
	freedSlot: FreedSlot;
	entries: readonly MatchEntry[];
	/** Scheduling data for the freed staff around the freed slot; `service` is set per entry. */
	scheduling: Omit<SchedulingContext, 'service'>;
	services: ReadonlyMap<string, Service>;
	/** Clients who already have an active booking with the shop on the freed slot's local day. */
	bookedThatDay: ReadonlySet<string>;
	/** Clients already at the shop's limit of upcoming bookings. */
	atBookingLimit: ReadonlySet<string>;
	/** Offers already made, as `entryId|staffId|startsAt`; a client is never offered the same slot twice. */
	previousOffers: ReadonlySet<string>;
	/** Entries already offered this freed slot in an earlier wave; the next wave goes to others. */
	offeredEntries: ReadonlySet<string>;
	minNoticeMinutes: number;
	now: Instant;
}

export interface MatchCandidate {
	entryId: string;
	clientId: string;
	serviceId: string;
	staffId: StaffId;
	startsAt: Instant;
	endsAt: Instant;
	blockedUntil: Instant;
}

export const offerKey = (entryId: string, staffId: string, startsAt: Instant) =>
	`${entryId}|${staffId}|${startsAt}`;

/** Whether a start time falls inside an entry's dates and time windows, in shop-local time. */
export function entryCoversStart(
	entry: Pick<MatchEntry, 'earliestDate' | 'latestDate' | 'timeWindows'>,
	startsAt: Instant,
	zone: TimeZone,
): boolean {
	const date = localDateOf(startsAt, zone);
	if (daysBetween(entry.earliestDate, date) < 0 || daysBetween(date, entry.latestDate) < 0) {
		return false;
	}
	if (entry.timeWindows.length === 0) return true;
	const weekday = weekdayOf(date);
	const minute = localMinuteOfDay(startsAt, zone);
	return entry.timeWindows.some(
		(w) => w.weekday === weekday && toMinute(w.start) <= minute && minute < toMinute(w.end),
	);
}

/**
 * Candidates for a freed slot, best first: specific-staff entries before any-staff, then oldest.
 * Each gets the earliest start the booking page would also offer inside the freed time.
 */
export function matchWaitlist(input: MatchInput): MatchCandidate[] {
	const { freedSlot, scheduling, now } = input;
	const zone = scheduling.settings.timezone;
	const date = localDateOf(freedSlot.startsAt, zone);
	const earliestStart = addMinutes(now, input.minNoticeMinutes);
	const startsByService = new Map<string, Instant[]>();

	const startsFor = (serviceId: string): Instant[] => {
		const cached = startsByService.get(serviceId);
		if (cached) return cached;
		const service = input.services.get(serviceId);
		const starts = service
			? generateSlots({
					...scheduling,
					service,
					staffIds: [freedSlot.staffId],
					range: { from: date, to: date },
				})
					.map((s) => s.startsAt)
					.filter((s) => s >= freedSlot.startsAt && s < freedSlot.endsAt && s >= earliestStart)
			: [];
		startsByService.set(serviceId, starts);
		return starts;
	};

	const candidates: (MatchCandidate & { specific: boolean; createdAt: Instant })[] = [];
	for (const entry of input.entries) {
		if (entry.staffId !== null && entry.staffId !== freedSlot.staffId) continue;
		if (entry.smsOptedOut || !entry.hasPhone || entry.hasOpenOffer) continue;
		if (input.offeredEntries.has(entry.id)) continue;
		if (input.bookedThatDay.has(entry.clientId) || input.atBookingLimit.has(entry.clientId)) {
			continue;
		}
		const service = input.services.get(entry.serviceId);
		if (!service) continue;

		const startsAt = startsFor(entry.serviceId).find(
			(s) =>
				entryCoversStart(entry, s, zone) &&
				!input.previousOffers.has(offerKey(entry.id, freedSlot.staffId, s)),
		);
		if (startsAt === undefined) continue;

		const times = computeBookingTimes({ startsAt, service });
		candidates.push({
			entryId: entry.id,
			clientId: entry.clientId,
			serviceId: entry.serviceId,
			staffId: freedSlot.staffId,
			...times,
			specific: entry.staffId !== null,
			createdAt: entry.createdAt,
		});
	}

	return candidates
		.sort(
			(a, b) =>
				Number(b.specific) - Number(a.specific) ||
				a.createdAt - b.createdAt ||
				a.entryId.localeCompare(b.entryId),
		)
		.filter((c, i, all) => all.findIndex((o) => o.clientId === c.clientId) === i)
		.map((c) => ({
			entryId: c.entryId,
			clientId: c.clientId,
			serviceId: c.serviceId,
			staffId: c.staffId,
			startsAt: c.startsAt,
			endsAt: c.endsAt,
			blockedUntil: c.blockedUntil,
		}));
}

function toMinute(time: string): number {
	return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}
