import type {
	AvailabilityRule,
	ExistingBooking,
	SchedulingContext,
	Service,
	ShopSchedulingSettings,
	TimeOff,
} from '@/lib/booking/types';
import { countryForCurrency } from '@/lib/contact/phone';
import type { Db } from '@/lib/shop/settings';
import { slugSchema } from '@/lib/shop/slug';
import {
	instantFromIso,
	instantToIso,
	localTime,
	timeZone,
	type Instant,
	type TimeZone,
} from '@/lib/time';
import type { PublicShop } from './types';

/** Server-side view of a shop for public routes. Never serialised to the browser. */
export interface BookingShop {
	id: string;
	slug: string;
	name: string;
	aboutText: string | null;
	address: string | null;
	phone: string | null;
	logoUrl: string | null;
	currency: string;
	bookingPageEnabled: boolean;
	timezone: TimeZone;
	settings: ShopSchedulingSettings;
	cancelCutoffHours: number;
}

export interface BookableService extends Service {
	id: string;
	name: string;
	priceCents: number;
}

export interface BookableStaff {
	id: string;
	displayName: string;
}

const SHOP_COLUMNS =
	'id, slug, name, about_text, address, phone, logo_url, currency, timezone, booking_page_enabled, slot_step_minutes, min_lead_minutes, max_horizon_days, cancel_cutoff_hours';

type ShopRow = {
	id: string;
	slug: string;
	name: string;
	about_text: string | null;
	address: string | null;
	phone: string | null;
	logo_url: string | null;
	currency: string;
	timezone: string;
	booking_page_enabled: boolean;
	slot_step_minutes: number;
	min_lead_minutes: number;
	max_horizon_days: number;
	cancel_cutoff_hours: number;
};

export function toBookingShop(row: ShopRow): BookingShop {
	const zone = timeZone(row.timezone);
	return {
		id: row.id,
		slug: row.slug,
		name: row.name,
		aboutText: row.about_text,
		address: row.address,
		phone: row.phone,
		logoUrl: row.logo_url,
		currency: row.currency,
		bookingPageEnabled: row.booking_page_enabled,
		timezone: zone,
		settings: {
			timezone: zone,
			slotStepMinutes: row.slot_step_minutes,
			minLeadMinutes: row.min_lead_minutes,
			maxHorizonDays: row.max_horizon_days,
		},
		cancelCutoffHours: row.cancel_cutoff_hours,
	};
}

/** The shop behind a public booking page, or null if unknown or not published. */
export async function loadBookingShop(db: Db, slug: string): Promise<BookingShop | null> {
	if (!slugSchema.safeParse(slug).success) return null;
	const { data, error } = await db
		.from('shops')
		.select(SHOP_COLUMNS)
		.eq('slug', slug)
		.eq('booking_page_enabled', true)
		.maybeSingle();
	if (error) throw error;
	return data ? toBookingShop(data) : null;
}

export async function loadShopById(db: Db, shopId: string): Promise<BookingShop | null> {
	const { data, error } = await db
		.from('shops')
		.select(SHOP_COLUMNS)
		.eq('id', shopId)
		.maybeSingle();
	if (error) throw error;
	return data ? toBookingShop(data) : null;
}

export async function loadActiveServices(db: Db, shopId: string): Promise<BookableService[]> {
	const { data, error } = await db
		.from('services')
		.select('id, name, duration_minutes, buffer_minutes, price_cents')
		.eq('shop_id', shopId)
		.eq('active', true)
		.order('sort_order')
		.order('created_at');
	if (error) throw error;
	return data.map((s) => ({
		id: s.id,
		name: s.name,
		durationMinutes: s.duration_minutes,
		bufferMinutes: s.buffer_minutes,
		priceCents: s.price_cents,
	}));
}

export async function loadActiveStaff(db: Db, shopId: string): Promise<BookableStaff[]> {
	const { data, error } = await db
		.from('staff')
		.select('id, display_name')
		.eq('shop_id', shopId)
		.eq('active', true)
		.order('created_at')
		.order('id');
	if (error) throw error;
	return data.map((s) => ({ id: s.id, displayName: s.display_name }));
}

/** Public page data plus the shop id, which callers use server-side only (e.g. cache tags). */
export async function getPublicShop(
	db: Db,
	slug: string,
): Promise<{ shopId: string; shop: PublicShop } | null> {
	const shop = await loadBookingShop(db, slug);
	if (!shop) return null;
	const [services, staff] = await Promise.all([
		loadActiveServices(db, shop.id),
		loadActiveStaff(db, shop.id),
	]);
	return {
		shopId: shop.id,
		shop: {
			slug: shop.slug,
			name: shop.name,
			aboutText: shop.aboutText,
			address: shop.address,
			phone: shop.phone,
			logoUrl: shop.logoUrl,
			timezone: shop.timezone,
			currency: shop.currency,
			country: countryForCurrency(shop.currency) === 'US' ? 'US' : 'CA',
			services: services.map(({ id, name, durationMinutes, priceCents }) => ({
				id,
				name,
				durationMinutes,
				priceCents,
			})),
			staff,
		},
	};
}

export interface SchedulingWindow {
	start: Instant;
	end: Instant;
}

/**
 * Rules, time off and blocking bookings for `staffIds` overlapping `window`. Expired `pending`
 * holds are left out; `excludeBookingId` drops the booking being rescheduled.
 */
export async function loadSchedulingContext(
	db: Db,
	shop: BookingShop,
	service: Service,
	staffIds: readonly string[],
	window: SchedulingWindow,
	now: Instant,
	excludeBookingId?: string,
): Promise<SchedulingContext> {
	const ids = [...staffIds];
	const start = instantToIso(window.start);
	const end = instantToIso(window.end);

	let bookingsQuery = db
		.from('bookings')
		.select('id, staff_id, starts_at, blocked_until, status, pending_expires_at')
		.eq('shop_id', shop.id)
		.in('staff_id', ids)
		.in('status', ['pending', 'confirmed'])
		.lt('starts_at', end)
		.gt('blocked_until', start);
	if (excludeBookingId) bookingsQuery = bookingsQuery.neq('id', excludeBookingId);

	const [rules, timeOff, bookings] = await Promise.all([
		db
			.from('availability_rules')
			.select('staff_id, weekday, start_time, end_time')
			.eq('shop_id', shop.id)
			.in('staff_id', ids),
		db
			.from('time_off')
			.select('staff_id, starts_at, ends_at')
			.eq('shop_id', shop.id)
			.in('staff_id', ids)
			.lt('starts_at', end)
			.gt('ends_at', start),
		bookingsQuery,
	]);
	for (const result of [rules, timeOff, bookings]) if (result.error) throw result.error;

	return {
		settings: shop.settings,
		service,
		now,
		rules: (rules.data ?? []).map((r): AvailabilityRule => ({
			staffId: r.staff_id,
			weekday: r.weekday,
			startTime: localTime(r.start_time),
			endTime: localTime(r.end_time),
		})),
		timeOff: (timeOff.data ?? []).map((t): TimeOff => ({
			staffId: t.staff_id,
			startsAt: instantFromIso(t.starts_at),
			endsAt: instantFromIso(t.ends_at),
		})),
		bookings: (bookings.data ?? [])
			.filter(
				(b) =>
					b.status === 'confirmed' ||
					b.pending_expires_at === null ||
					instantFromIso(b.pending_expires_at) > now,
			)
			.map((b): ExistingBooking => ({
				staffId: b.staff_id,
				startsAt: instantFromIso(b.starts_at),
				blockedUntil: instantFromIso(b.blocked_until),
			})),
	};
}
