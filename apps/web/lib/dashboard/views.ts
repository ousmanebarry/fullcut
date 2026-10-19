// Page models for the Today screen and calendar, assembled on the server (Luxon stays off the client).
import 'server-only';
import { generateSlots } from '@/lib/booking/generate-slots';
import {
	loadActiveServices,
	loadActiveStaff,
	loadSchedulingContext,
	type BookingShop,
} from '@/lib/public-booking/data';
import type { Actor, Db } from '@/lib/shop/settings';
import { localDateOf, plusDays, weekdayOf, type Instant, type LocalDate } from '@/lib/time';
import { buildCalendarLayout, type CalendarLayout } from './calendar-layout';
import {
	countUnmarked,
	dateLabel,
	dayWindow,
	loadBookings,
	loadScheduleShading,
	staffSettings,
} from './queries';
import type { CalendarParams } from './schemas';
import type { CalendarView, DashboardBooking, ServiceOption, StaffOption } from './types';

export interface CalendarModel {
	view: CalendarView;
	date: LocalDate;
	today: LocalDate;
	prevDate: LocalDate;
	nextDate: LocalDate;
	title: string;
	timezone: string;
	currency: string;
	staff: StaffOption[];
	selectedStaffId: string | null;
	services: ServiceOption[];
	layout: CalendarLayout;
	bookings: DashboardBooking[];
}

async function loadOptions(db: Db, shop: BookingShop) {
	const [staff, services] = await Promise.all([
		loadActiveStaff(db, shop.id),
		loadActiveServices(db, shop.id),
	]);
	return {
		staff: staff.map((s): StaffOption => ({ id: s.id, name: s.displayName })),
		services: services.map((s): ServiceOption => ({
			id: s.id,
			name: s.name,
			durationMinutes: s.durationMinutes,
			priceCents: s.priceCents,
		})),
	};
}

// Server components may not call Date.now() in their body (react-hooks/purity).
export function currentInstant(): Instant {
	return Date.now() as Instant;
}

export function weekStart(date: LocalDate): LocalDate {
	return plusDays(date, -((weekdayOf(date) + 6) % 7));
}

export async function loadCalendar(
	db: Db,
	shop: BookingShop,
	actor: Actor,
	params: CalendarParams,
	now: Instant,
): Promise<CalendarModel> {
	const zone = shop.timezone;
	const today = localDateOf(now, zone);
	const date = params.date ?? today;
	const { staff, services } = await loadOptions(db, shop);
	const selectedStaffId =
		staff.find((s) => s.id === params.staff)?.id ??
		staff.find((s) => s.id === actor.staffId)?.id ??
		staff[0]?.id ??
		null;

	const isWeek = params.view === 'week';
	const from = isWeek ? weekStart(date) : date;
	const days = isWeek ? 7 : 1;
	const staffIds = isWeek ? (selectedStaffId ? [selectedStaffId] : []) : staff.map((s) => s.id);
	const window = dayWindow(from, zone, days);

	const [bookings, shading] = await Promise.all([
		staffIds.length ? loadBookings(db, shop, window, { staffIds }) : Promise.resolve([]),
		staffIds.length
			? loadScheduleShading(db, shop, staffIds, window)
			: Promise.resolve({ rules: [], timeOff: [] }),
	]);

	const columns = isWeek
		? Array.from({ length: 7 }, (_, i) => {
				const day = plusDays(from, i);
				return { key: day, staffId: selectedStaffId ?? '', date: day, title: dateLabel(day) };
			})
		: staff.map((s) => ({ key: s.id, staffId: s.id, date, title: s.name }));

	const layout = buildCalendarLayout({
		zone,
		columns,
		bookings: bookings.map((b) => ({
			id: b.id,
			staffId: b.staffId,
			startsAt: b.startsAtMs as Instant,
			endsAt: b.endsAtMs as Instant,
			blockedUntil: b.blockedUntilMs as Instant,
		})),
		...shading,
	});

	return {
		view: isWeek ? 'week' : 'day',
		date,
		today,
		prevDate: plusDays(date, -days),
		nextDate: plusDays(date, days),
		title: isWeek ? `${dateLabel(from)} – ${dateLabel(plusDays(from, 6))}` : dateLabel(date),
		timezone: zone,
		currency: shop.currency,
		staff,
		selectedStaffId,
		services,
		layout,
		bookings,
	};
}

export interface TodayModel {
	today: LocalDate;
	title: string;
	currency: string;
	ownOnly: boolean;
	bookings: DashboardBooking[];
	unmarked: number;
	bookingsToday: number;
	openSlotsLeft: number | null;
}

/** Owners see the whole shop; staff linked to a profile see their own day. */
export async function loadToday(
	db: Db,
	shop: BookingShop,
	actor: Actor,
	now: Instant,
): Promise<TodayModel> {
	const zone = shop.timezone;
	const today = localDateOf(now, zone);
	const ownStaffId = actor.role === 'staff' ? actor.staffId : null;

	const [staff, services] = await Promise.all([
		loadActiveStaff(db, shop.id),
		loadActiveServices(db, shop.id),
	]);
	const staffIds = ownStaffId ? [ownStaffId] : staff.map((s) => s.id);
	const window = dayWindow(today, zone);

	const [bookings, unmarked] = await Promise.all([
		staffIds.length ? loadBookings(db, shop, window, { staffIds }) : Promise.resolve([]),
		countUnmarked(db, shop, now, ownStaffId),
	]);

	// Open slots are counted for the shortest active service, per staff member.
	const shortest = services.toSorted(
		(a, b) => a.durationMinutes + a.bufferMinutes - (b.durationMinutes + b.bufferMinutes),
	)[0];
	let openSlotsLeft: number | null = null;
	if (shortest && staffIds.length) {
		const ctx = await loadSchedulingContext(db, shop, shortest, staffIds, window, now);
		openSlotsLeft = staffIds.reduce(
			(sum, staffId) =>
				sum +
				generateSlots({
					...ctx,
					settings: staffSettings(shop),
					staffIds: [staffId],
					range: { from: today, to: today },
				}).length,
			0,
		);
	}

	return {
		today,
		title: dateLabel(today),
		currency: shop.currency,
		ownOnly: ownStaffId !== null,
		bookings,
		unmarked,
		bookingsToday: bookings.filter((b) => b.status !== 'cancelled').length,
		openSlotsLeft,
	};
}
