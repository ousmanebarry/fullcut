// Dashboard booking writes. Callers pass a user-scoped client (RLS applies), the actor and the shop,
// both derived on the server. Status changes go through transitionBooking; times through the engine.
import { transitionBooking, type TransitionError } from '@/lib/booking/transition-booking';
import type { BookingEvent, BookingStatus, Result } from '@/lib/booking/types';
import {
	validateStaffStart,
	type StaffStartRejection,
} from '@/lib/booking/validate-requested-start';
import { countryForCurrency, normalizePhone } from '@/lib/contact/phone';
import { toUserFacingError } from '@/lib/db/errors';
import { loadDayContext } from '@/lib/public-booking/booking';
import type { BookableService, BookingShop } from '@/lib/public-booking/data';
import { linkExpiry } from '@/lib/public-booking/links';
import type { Actor, Db } from '@/lib/shop/settings';
import {
	instantFromIso,
	instantToIso,
	parseLocalTime,
	zonedToInstant,
	localTime,
	type Instant,
	type LocalDate,
} from '@/lib/time';
import { staffSettings, suggestedSlots } from './queries';
import type { EditBookingInput, ManualBookingInput } from './schemas';
import type { DashboardSlot, Outcome } from './types';

export interface DashboardError {
	message: string;
	field?: string;
	suggestions?: DashboardSlot[];
}

export type DashboardResult<T = null> = Result<T, DashboardError>;

export const BOOKING_NOT_FOUND: DashboardError = { message: 'That booking no longer exists.' };
export const BOOKING_CHANGED: DashboardError = {
	message: 'This booking was just changed by someone else. Check it and try again.',
};
export const OVERRIDE_OWNER_ONLY: DashboardError = {
	message: 'Only the shop owner can book outside working hours.',
};

const TRANSITION_MESSAGES: Record<TransitionError['code'], string> = {
	invalid_transition: "This booking can't be changed that way any more.",
	too_early: 'You can mark the outcome once the appointment has started.',
	hold_not_expired: "This booking can't be changed that way any more.",
	undo_window_passed: 'Outcomes can only be undone on the day they were marked.',
};

const START_MESSAGES: Record<StaffStartRejection, string> = {
	misaligned: 'Choose a time on a whole minute.',
	outside_hours: "That's outside working hours.",
	time_off: "They're off at that time.",
	conflict: 'That time overlaps another booking.',
};

const ok = <T>(value: T): DashboardResult<T> => ({ ok: true, value });
const fail = (error: DashboardError): DashboardResult<never> => ({ ok: false, error });

export function transitionMessage(error: TransitionError): string {
	return TRANSITION_MESSAGES[error.code];
}

export function startsAtFor(shop: BookingShop, date: LocalDate, time: string): Instant {
	return zonedToInstant(date, parseLocalTime(localTime(time)), shop.timezone);
}

async function loadForUpdate(db: Db, actor: Actor, bookingId: string) {
	const { data, error } = await db
		.from('bookings')
		.select(
			'id, status, starts_at, pending_expires_at, outcome_marked_at, staff_id, service_id, price_cents',
		)
		.eq('shop_id', actor.shopId)
		.eq('id', bookingId)
		.maybeSingle();
	if (error) throw error;
	if (!data) return null;
	return {
		...data,
		status: data.status as BookingStatus,
		startsAt: instantFromIso(data.starts_at),
		pendingExpiresAt: data.pending_expires_at ? instantFromIso(data.pending_expires_at) : null,
		outcomeMarkedAt: data.outcome_marked_at ? instantFromIso(data.outcome_marked_at) : null,
	};
}

export type StatusEvent = Extract<
	BookingEvent,
	'markCompleted' | 'markNoShow' | 'undoOutcome' | 'cancel'
>;

export const OUTCOME_EVENTS: Record<Outcome, StatusEvent> = {
	completed: 'markCompleted',
	no_show: 'markNoShow',
};

/** Applies one status event; the update is conditional on the status we checked. */
export async function changeBookingStatus(
	db: Db,
	actor: Actor,
	shop: BookingShop,
	bookingId: string,
	event: StatusEvent,
	now: Instant,
	cancelReason?: string,
): Promise<DashboardResult<BookingStatus>> {
	const booking = await loadForUpdate(db, actor, bookingId);
	if (!booking) return fail(BOOKING_NOT_FOUND);

	const next = transitionBooking(booking, event, now, shop.timezone);
	if (!next.ok) return fail({ message: transitionMessage(next.error) });

	const { data, error } = await db
		.from('bookings')
		.update(
			event === 'cancel'
				? { status: next.value, cancel_reason: cancelReason ?? null }
				: { status: next.value },
		)
		.eq('shop_id', actor.shopId)
		.eq('id', bookingId)
		.eq('status', booking.status)
		.select('id');
	if (error?.code === '23P01') {
		return fail({ message: 'Another booking now takes that time, so this can’t be undone.' });
	}
	if (error) return fail(toUserFacingError(error));
	return data.length === 1 ? ok(next.value) : fail(BOOKING_CHANGED);
}

export async function markOutcomes(
	db: Db,
	actor: Actor,
	shop: BookingShop,
	bookingIds: readonly string[],
	outcome: Outcome,
	now: Instant,
): Promise<{ marked: number; failed: number }> {
	let marked = 0;
	for (const id of bookingIds) {
		const result = await changeBookingStatus(db, actor, shop, id, OUTCOME_EVENTS[outcome], now);
		if (result.ok) marked++;
	}
	return { marked, failed: bookingIds.length - marked };
}

async function loadService(
	db: Db,
	actor: Actor,
	serviceId: string,
	activeOnly: boolean,
): Promise<BookableService | null> {
	let query = db
		.from('services')
		.select('id, name, duration_minutes, buffer_minutes, price_cents')
		.eq('shop_id', actor.shopId)
		.eq('id', serviceId);
	if (activeOnly) query = query.eq('active', true);
	const { data, error } = await query.maybeSingle();
	if (error) throw error;
	return data
		? {
				id: data.id,
				name: data.name,
				durationMinutes: data.duration_minutes,
				bufferMinutes: data.buffer_minutes,
				priceCents: data.price_cents,
			}
		: null;
}

async function staffIsActive(db: Db, actor: Actor, staffId: string): Promise<boolean> {
	const { data, error } = await db
		.from('staff')
		.select('id')
		.eq('shop_id', actor.shopId)
		.eq('id', staffId)
		.eq('active', true)
		.maybeSingle();
	if (error) throw error;
	return data !== null;
}

interface PlannedTimes {
	service: BookableService;
	times: { startsAt: Instant; endsAt: Instant; blockedUntil: Instant };
}

/** Engine pre-check for a staff-made booking; not the double-booking guarantee (23P01 is). */
async function planTimes(
	db: Db,
	actor: Actor,
	shop: BookingShop,
	input: { serviceId: string; staffId: string; startsAt: Instant; overrideHours: boolean },
	service: BookableService,
	now: Instant,
	excludeBookingId?: string,
): Promise<DashboardResult<PlannedTimes>> {
	if (input.overrideHours && actor.role !== 'owner') return fail(OVERRIDE_OWNER_ONLY);

	const ctx = await loadDayContext(
		db,
		shop,
		service,
		[input.staffId],
		input.startsAt,
		now,
		excludeBookingId,
	);
	const checked = validateStaffStart({
		...ctx,
		settings: staffSettings(shop),
		staffId: input.staffId,
		startsAt: input.startsAt,
		overrideHours: input.overrideHours,
	});
	if (!checked.ok) {
		const suggestions = await suggestedSlots(
			db,
			shop,
			service,
			input.staffId,
			input.startsAt,
			now,
			excludeBookingId,
		);
		return fail({ message: START_MESSAGES[checked.error], field: 'time', suggestions });
	}
	return ok({ service, times: checked.value });
}

async function takenError(
	db: Db,
	shop: BookingShop,
	service: BookableService,
	staffId: string,
	startsAt: Instant,
	now: Instant,
	excludeBookingId?: string,
): Promise<DashboardError> {
	return {
		message: 'That time was just taken. Here are the nearest open times.',
		field: 'time',
		suggestions: await suggestedSlots(db, shop, service, staffId, startsAt, now, excludeBookingId),
	};
}

/** Reschedule and/or change staff or service of a confirmed booking, in one UPDATE. */
export async function updateBooking(
	db: Db,
	actor: Actor,
	shop: BookingShop,
	input: EditBookingInput,
	now: Instant,
): Promise<DashboardResult<{ startsAt: Instant }>> {
	const booking = await loadForUpdate(db, actor, input.bookingId);
	if (!booking) return fail(BOOKING_NOT_FOUND);
	if (booking.status !== 'confirmed') {
		return fail({ message: 'Only confirmed bookings can be moved.' });
	}

	const serviceChanged = input.serviceId !== booking.service_id;
	const service = await loadService(db, actor, input.serviceId, serviceChanged);
	if (!service) return fail({ message: 'That service is no longer offered.', field: 'serviceId' });
	if (input.staffId !== booking.staff_id && !(await staffIsActive(db, actor, input.staffId))) {
		return fail({ message: 'That staff member is no longer active.', field: 'staffId' });
	}

	const startsAt = startsAtFor(shop, input.date, input.time);
	const planned = await planTimes(
		db,
		actor,
		shop,
		{ ...input, startsAt },
		service,
		now,
		booking.id,
	);
	if (!planned.ok) return planned;
	const { times } = planned.value;

	const { data, error } = await db
		.from('bookings')
		.update({
			staff_id: input.staffId,
			service_id: service.id,
			starts_at: instantToIso(times.startsAt),
			ends_at: instantToIso(times.endsAt),
			blocked_until: instantToIso(times.blockedUntil),
			price_cents: serviceChanged ? service.priceCents : booking.price_cents,
		})
		.eq('shop_id', actor.shopId)
		.eq('id', booking.id)
		.eq('status', 'confirmed')
		.select('id');
	if (error?.code === '23P01') {
		return fail(await takenError(db, shop, service, input.staffId, startsAt, now, booking.id));
	}
	if (error) return fail(toUserFacingError(error));
	return data.length === 1 ? ok({ startsAt: times.startsAt }) : fail(BOOKING_CHANGED);
}

/** Keeps the client's manage link valid after a staff reschedule. `admin` must be the service-role client. */
export async function extendManageLink(
	admin: Db,
	shopId: string,
	bookingId: string,
	startsAt: Instant,
): Promise<void> {
	const { error } = await admin
		.from('booking_links')
		.update({ expires_at: instantToIso(linkExpiry(startsAt)) })
		.eq('shop_id', shopId)
		.eq('booking_id', bookingId)
		.is('revoked_at', null);
	if (error) throw error;
}

/** Phone or walk-in booking: client picked, found by phone, or created; then the atomic RPC. */
export async function createManualBooking(
	db: Db,
	actor: Actor,
	shop: BookingShop,
	input: ManualBookingInput,
	now: Instant,
): Promise<DashboardResult<{ bookingId: string }>> {
	let phoneE164: string | null = null;
	if (!input.clientId && input.phone) {
		phoneE164 = normalizePhone(input.phone, countryForCurrency(shop.currency));
		if (!phoneE164) return fail({ message: 'Enter a valid phone number.', field: 'phone' });
	}

	const service = await loadService(db, actor, input.serviceId, true);
	if (!service) return fail({ message: 'That service is no longer offered.', field: 'serviceId' });
	if (!(await staffIsActive(db, actor, input.staffId))) {
		return fail({ message: 'That staff member is no longer active.', field: 'staffId' });
	}

	const startsAt = startsAtFor(shop, input.date, input.time);
	const planned = await planTimes(db, actor, shop, { ...input, startsAt }, service, now);
	if (!planned.ok) return planned;
	const { times } = planned.value;

	const { data, error } = await db
		.rpc('create_staff_booking', {
			p_shop_id: actor.shopId,
			p_staff_id: input.staffId,
			p_service_id: service.id,
			p_starts_at: instantToIso(times.startsAt),
			p_ends_at: instantToIso(times.endsAt),
			p_blocked_until: instantToIso(times.blockedUntil),
			p_price_cents: service.priceCents,
			p_source: input.source,
			p_client_name: input.clientName ?? '',
			p_notes: input.notes ?? '',
			p_client_id: input.clientId,
			p_phone_e164: phoneE164 ?? undefined,
		})
		.single();
	if (error?.code === '23P01') {
		return fail(await takenError(db, shop, service, input.staffId, startsAt, now));
	}
	if (error?.code === '23503') return fail({ message: 'That client no longer exists.' });
	if (error) return fail(toUserFacingError(error));
	return ok({ bookingId: data.booking_id });
}
