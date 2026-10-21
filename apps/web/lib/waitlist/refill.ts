import 'server-only';
import { dateWindow } from '@/lib/public-booking/availability';
import {
	loadActiveServices,
	loadSchedulingContext,
	loadShopById,
	type BookingShop,
} from '@/lib/public-booking/data';
import type { Database } from '@/lib/database.types';
import { quietHoursEnd } from '@/lib/messaging/rules';
import type { Db } from '@/lib/shop/settings';
import {
	addMinutes,
	instantFromIso,
	instantToIso,
	localDate,
	localDateOf,
	plusDays,
	type Instant,
	type LocalDate,
} from '@/lib/time';
import { matchWaitlist, offerKey, type FreedSlot, type MatchEntry } from './match';
import { parseWindows } from './types';

type FreedSlotRow = Database['public']['Tables']['freed_slots']['Row'];
type FreedSlotPatch = Database['public']['Tables']['freed_slots']['Update'];

const CLAIM_BATCH = 10;
const RETRY_MINUTES = 1;

export type RefillOutcome =
	'offered' | 'waiting' | 'exhausted' | 'dropped' | 'cancelled' | 'failed';
export type RefillCounts = Record<RefillOutcome, number> & {
	offersExpired: number;
	entriesExpired: number;
};

export interface RefillOptions {
	clock?: () => Instant;
	budgetMs?: number;
}

export interface WaitlistSettings {
	enabled: boolean;
	waveSize: number;
	offerMinutes: number;
	minNoticeMinutes: number;
	maxActiveBookings: number;
}

/** Expires stale offers and entries, then works every due freed slot: wait, drop, or send the next wave. */
export async function runWaitlistBatch(db: Db, options: RefillOptions = {}): Promise<RefillCounts> {
	const clock = options.clock ?? (() => Date.now() as Instant);
	const deadline = clock() + (options.budgetMs ?? 15_000);
	const counts: RefillCounts = {
		offered: 0,
		waiting: 0,
		exhausted: 0,
		dropped: 0,
		cancelled: 0,
		failed: 0,
		offersExpired: 0,
		entriesExpired: 0,
	};

	const expired = await db.rpc('expire_waitlist').single();
	if (expired.error) throw expired.error;
	counts.offersExpired = expired.data.offers_expired;
	counts.entriesExpired = expired.data.entries_expired;

	for (;;) {
		const { data, error } = await db.rpc('claim_due_freed_slots', { p_limit: CLAIM_BATCH });
		if (error) throw error;
		for (const row of data) counts[await processFreedSlot(db, row, clock())]++;
		if (data.length < CLAIM_BATCH || clock() >= deadline) return counts;
	}
}

async function processFreedSlot(db: Db, row: FreedSlotRow, now: Instant): Promise<RefillOutcome> {
	const release = async (patch: FreedSlotPatch) => {
		const { error } = await db
			.from('freed_slots')
			.update({ ...patch, locked_at: null })
			.eq('id', row.id);
		if (error) throw error;
	};

	try {
		const [shop, settings] = await Promise.all([
			loadShopById(db, row.shop_id),
			loadWaitlistSettings(db, row.shop_id),
		]);
		if (!shop || !settings?.enabled) {
			await release({ status: 'cancelled' });
			return 'cancelled';
		}

		const freed: FreedSlot = {
			staffId: row.staff_id,
			startsAt: instantFromIso(row.starts_at),
			endsAt: instantFromIso(row.ends_at),
		};
		const lastOfferMoment = addMinutes(freed.startsAt, -settings.minNoticeMinutes);
		if (now >= lastOfferMoment) {
			await release({ status: 'dropped', drop_reason: 'too_late' });
			return 'dropped';
		}

		const open = await db
			.from('slot_offers')
			.select('expires_at')
			.eq('shop_id', row.shop_id)
			.eq('freed_slot_id', row.id)
			.eq('status', 'sent')
			.order('expires_at', { ascending: false })
			.limit(1);
		if (open.error) throw open.error;
		const openUntil = open.data[0]?.expires_at;
		if (openUntil) {
			await release({ next_run_at: openUntil });
			return 'waiting';
		}

		// Never offer during quiet hours; if waiting for morning misses the notice, give the slot up.
		const morning = quietHoursEnd(now, shop.timezone);
		if (morning !== null) {
			if (morning >= lastOfferMoment) {
				await release({ status: 'dropped', drop_reason: 'quiet_hours' });
				return 'dropped';
			}
			await release({ next_run_at: instantToIso(morning) });
			return 'waiting';
		}

		const candidates = matchWaitlist(await loadMatchInput(db, shop, settings, row.id, freed, now));
		const wave = candidates.slice(0, settings.waveSize);
		if (wave.length === 0) {
			await release({ status: 'exhausted' });
			return 'exhausted';
		}

		const offerMinutesEnd = addMinutes(now, settings.offerMinutes);
		const expiresAt = offerMinutesEnd < lastOfferMoment ? offerMinutesEnd : lastOfferMoment;
		const created = await db.rpc('create_slot_offers', {
			p_freed_slot_id: row.id,
			p_offers: wave.map((c) => ({
				entry_id: c.entryId,
				service_id: c.serviceId,
				starts_at: instantToIso(c.startsAt),
				ends_at: instantToIso(c.endsAt),
				blocked_until: instantToIso(c.blockedUntil),
			})),
			p_expires_at: instantToIso(expiresAt),
			p_next_run_at: instantToIso(expiresAt),
		});
		if (created.error) throw created.error;
		if (created.data === 0) {
			// Entries changed under us; match again on the next tick.
			await release({ next_run_at: instantToIso(addMinutes(now, RETRY_MINUTES)) });
			return 'waiting';
		}
		return 'offered';
	} catch (error) {
		console.error('[waitlist] freed slot %s failed: %o', row.id, error);
		await release({ next_run_at: instantToIso(addMinutes(now, RETRY_MINUTES)) }).catch(
			() => undefined,
		);
		return 'failed';
	}
}

export async function loadWaitlistSettings(
	db: Db,
	shopId: string,
): Promise<WaitlistSettings | null> {
	const { data, error } = await db
		.from('shops')
		.select(
			'waitlist_enabled, waitlist_wave_size, waitlist_offer_minutes, waitlist_min_notice_minutes, max_active_bookings_per_phone',
		)
		.eq('id', shopId)
		.maybeSingle();
	if (error) throw error;
	if (!data) return null;
	return {
		enabled: data.waitlist_enabled,
		waveSize: data.waitlist_wave_size,
		offerMinutes: data.waitlist_offer_minutes,
		minNoticeMinutes: data.waitlist_min_notice_minutes,
		maxActiveBookings: data.max_active_bookings_per_phone,
	};
}

/**
 * Everything matchWaitlist needs for one freed time. `freedSlotId` is null for a standby preview of a
 * booking that still holds the time (`excludeBookingId`).
 */
export async function loadMatchInput(
	db: Db,
	shop: BookingShop,
	settings: WaitlistSettings,
	freedSlotId: string | null,
	freed: FreedSlot,
	now: Instant,
	excludeBookingId?: string,
) {
	const zone = shop.timezone;
	const date: LocalDate = localDateOf(freed.startsAt, zone);
	const day = dateWindow(date, date, zone);
	const nowIso = instantToIso(now);
	const sameDayOffers = `and(staff_id.eq.${freed.staffId},starts_at.gte.${instantToIso(day.start)},starts_at.lt.${instantToIso(day.end)})`;

	const [entriesResult, services] = await Promise.all([
		db
			.from('waitlist_entries')
			.select(
				'id, client_id, service_id, staff_id, earliest_date, latest_date, time_windows, created_at, client:clients!waitlist_entries_client_same_shop_fk(phone_e164, sms_opted_out)',
			)
			.eq('shop_id', shop.id)
			.eq('status', 'active')
			.lte('earliest_date', date)
			.gte('latest_date', date)
			.or(`staff_id.is.null,staff_id.eq.${freed.staffId}`),
		loadActiveServices(db, shop.id),
	]);
	if (entriesResult.error) throw entriesResult.error;
	const rows = entriesResult.data;
	const entryIds = rows.map((e) => e.id);
	const clientIds = [...new Set(rows.map((e) => e.client_id))];

	const [openOffers, previous, upcoming, scheduling] = await Promise.all([
		db
			.from('slot_offers')
			.select('entry:waitlist_entries!slot_offers_entry_same_shop_fk(client_id)')
			.eq('shop_id', shop.id)
			.eq('status', 'sent')
			.gt('expires_at', nowIso),
		db
			.from('slot_offers')
			.select('waitlist_entry_id, staff_id, starts_at, freed_slot_id')
			.eq('shop_id', shop.id)
			.in('waitlist_entry_id', entryIds)
			.or(freedSlotId ? `freed_slot_id.eq.${freedSlotId},${sameDayOffers}` : sameDayOffers),
		db
			.from('bookings')
			.select('client_id, starts_at')
			.eq('shop_id', shop.id)
			.in('client_id', clientIds)
			.in('status', ['pending', 'confirmed'])
			.gt('starts_at', nowIso),
		// The service only shapes slot lengths; matchWaitlist sets it per entry.
		loadSchedulingContext(
			db,
			shop,
			{ durationMinutes: 1, bufferMinutes: 0 },
			[freed.staffId],
			dateWindow(plusDays(date, -1), plusDays(date, 1), zone),
			now,
			excludeBookingId,
		),
	]);
	for (const result of [openOffers, previous, upcoming]) if (result.error) throw result.error;

	const withOpenOffer = new Set((openOffers.data ?? []).map((o) => o.entry.client_id));
	const bookedThatDay = new Set<string>();
	const upcomingCount = new Map<string, number>();
	for (const b of upcoming.data ?? []) {
		const startsAt = instantFromIso(b.starts_at);
		if (localDateOf(startsAt, zone) === date) bookedThatDay.add(b.client_id);
		upcomingCount.set(b.client_id, (upcomingCount.get(b.client_id) ?? 0) + 1);
	}

	const entries: MatchEntry[] = rows.map((e) => ({
		id: e.id,
		clientId: e.client_id,
		serviceId: e.service_id,
		staffId: e.staff_id,
		earliestDate: localDate(e.earliest_date),
		latestDate: localDate(e.latest_date),
		timeWindows: parseWindows(e.time_windows),
		createdAt: instantFromIso(e.created_at),
		smsOptedOut: e.client.sms_opted_out,
		hasPhone: e.client.phone_e164 !== null,
		hasOpenOffer: withOpenOffer.has(e.client_id),
	}));

	return {
		freedSlot: freed,
		entries,
		scheduling: {
			settings: scheduling.settings,
			rules: scheduling.rules,
			timeOff: scheduling.timeOff,
			bookings: scheduling.bookings,
			now,
		},
		services: new Map(services.map((s) => [s.id, s])),
		bookedThatDay,
		atBookingLimit: new Set(
			[...upcomingCount].filter(([, n]) => n >= settings.maxActiveBookings).map(([id]) => id),
		),
		previousOffers: new Set(
			(previous.data ?? []).map((o) =>
				offerKey(o.waitlist_entry_id, o.staff_id, instantFromIso(o.starts_at)),
			),
		),
		offeredEntries: new Set(
			(previous.data ?? [])
				.filter((o) => o.freed_slot_id === freedSlotId)
				.map((o) => o.waitlist_entry_id),
		),
		minNoticeMinutes: settings.minNoticeMinutes,
		now,
	};
}
