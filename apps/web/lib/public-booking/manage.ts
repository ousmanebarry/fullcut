import { transitionBooking } from '@/lib/booking/transition-booking';
import type { BookingStatus, Result } from '@/lib/booking/types';
import type { Db } from '@/lib/shop/settings';
import { addMinutes, instantFromIso, instantToIso, type Instant } from '@/lib/time';
import { candidatesForStart, staffIdsFor, suggestionsNear } from './availability';
import { bookingDetails, loadDayContext, staffName, type BookingFailure } from './booking';
import { loadActiveStaff, loadShopById, type BookableService, type BookingShop } from './data';
import { bookingReference, hashToken, linkExpiry } from './links';
import { TOKEN_PATTERN, type StaffChoice } from './schemas';
import type { BookingDetails } from './types';

export interface ManagedBooking {
	bookingId: string;
	reference: string;
	shop: BookingShop;
	status: BookingStatus;
	startsAt: Instant;
	endsAt: Instant;
	pendingExpiresAt: Instant | null;
	staffId: string;
	staffName: string;
	service: BookableService;
	priceCents: number;
}

export interface ManagePolicy {
	canCancel: boolean;
	canReschedule: boolean;
	/** Last moment the client may change the booking online. */
	changeDeadline: Instant;
}

/** The booking behind a manage-link token; unknown, tampered, expired and revoked all give null. */
export async function findBookingByToken(
	db: Db,
	token: string,
	now: Instant,
): Promise<ManagedBooking | null> {
	if (!TOKEN_PATTERN.test(token)) return null;
	const { data: link, error: linkError } = await db
		.from('booking_links')
		.select('booking_id, shop_id')
		.eq('token_hash', hashToken(token))
		.is('revoked_at', null)
		.gt('expires_at', instantToIso(now))
		.maybeSingle();
	if (linkError) throw linkError;
	if (!link) return null;

	const { data: booking, error } = await db
		.from('bookings')
		.select('id, status, starts_at, ends_at, staff_id, service_id, price_cents, pending_expires_at')
		.eq('id', link.booking_id)
		.eq('shop_id', link.shop_id)
		.maybeSingle();
	if (error) throw error;
	if (!booking) return null;

	const [shop, service, staff] = await Promise.all([
		loadShopById(db, link.shop_id),
		db
			.from('services')
			.select('id, name, duration_minutes, buffer_minutes, price_cents')
			.eq('shop_id', link.shop_id)
			.eq('id', booking.service_id)
			.single(),
		db
			.from('staff')
			.select('display_name')
			.eq('shop_id', link.shop_id)
			.eq('id', booking.staff_id)
			.single(),
	]);
	if (service.error) throw service.error;
	if (staff.error) throw staff.error;
	if (!shop) return null;

	return {
		bookingId: booking.id,
		reference: bookingReference(booking.id),
		shop,
		status: booking.status as BookingStatus,
		startsAt: instantFromIso(booking.starts_at),
		endsAt: instantFromIso(booking.ends_at),
		pendingExpiresAt: booking.pending_expires_at
			? instantFromIso(booking.pending_expires_at)
			: null,
		staffId: booking.staff_id,
		staffName: staff.data.display_name,
		service: {
			id: service.data.id,
			name: service.data.name,
			durationMinutes: service.data.duration_minutes,
			bufferMinutes: service.data.buffer_minutes,
			priceCents: service.data.price_cents,
		},
		priceCents: booking.price_cents,
	};
}

export function managePolicy(booking: ManagedBooking, now: Instant): ManagePolicy {
	const changeDeadline = addMinutes(booking.startsAt, -booking.shop.cancelCutoffHours * 60);
	const beforeDeadline = now < changeDeadline && now < booking.startsAt;
	const cancellable = transitionBooking(booking, 'cancel', now).ok;
	return {
		canCancel: cancellable && beforeDeadline,
		canReschedule:
			booking.status === 'confirmed' && beforeDeadline && booking.shop.bookingPageEnabled,
		changeDeadline,
	};
}

export function managedDetails(booking: ManagedBooking): BookingDetails {
	return bookingDetails(booking.shop, {
		serviceName: booking.service.name,
		staffName: booking.staffName,
		startsAt: booking.startsAt,
		endsAt: booking.endsAt,
		priceCents: booking.priceCents,
	});
}

type CancelError = Extract<BookingFailure, { kind: 'not_active' | 'cancel_window_passed' }>;

export async function cancelManagedBooking(
	db: Db,
	booking: ManagedBooking,
	now: Instant,
): Promise<Result<null, CancelError>> {
	if (!transitionBooking(booking, 'cancel', now).ok || now >= booking.startsAt) {
		return { ok: false, error: { kind: 'not_active' } };
	}
	if (!managePolicy(booking, now).canCancel) {
		return { ok: false, error: { kind: 'cancel_window_passed' } };
	}
	const { data, error } = await db
		.from('bookings')
		.update({ status: 'cancelled' })
		.eq('id', booking.bookingId)
		.eq('shop_id', booking.shop.id)
		.in('status', ['pending', 'confirmed'])
		.select('id');
	if (error) throw error;
	return data.length === 1
		? { ok: true, value: null }
		: { ok: false, error: { kind: 'not_active' } };
}

type RescheduleError = Extract<
	BookingFailure,
	{ kind: 'not_active' | 'cancel_window_passed' | 'not_found' | 'unavailable' | 'taken' }
>;

/** Moves a confirmed booking in a single UPDATE; the exclusion constraint guards it like an insert. */
export async function rescheduleManagedBooking(
	db: Db,
	booking: ManagedBooking,
	request: { staffId: StaffChoice; startsAt: Instant },
	now: Instant,
): Promise<Result<BookingDetails, RescheduleError>> {
	if (booking.status !== 'confirmed' || now >= booking.startsAt) {
		return { ok: false, error: { kind: 'not_active' } };
	}
	if (!managePolicy(booking, now).canReschedule) {
		return { ok: false, error: { kind: 'cancel_window_passed' } };
	}

	const { shop, service } = booking;
	const staff = await loadActiveStaff(db, shop.id);
	const staffIds = staffIdsFor(request.staffId, staff);
	if (!staffIds || staffIds.length === 0) return { ok: false, error: { kind: 'not_found' } };

	const ctx = await loadDayContext(
		db,
		shop,
		service,
		staffIds,
		request.startsAt,
		now,
		booking.bookingId,
	);
	const picked = candidatesForStart(ctx, staffIds, request.startsAt);
	if (!picked.ok) {
		const suggestions = await suggestionsNear(
			db,
			shop,
			service,
			staffIds,
			request.startsAt,
			now,
			booking.bookingId,
		);
		return { ok: false, error: { kind: 'unavailable', reason: picked.error, suggestions } };
	}

	for (const candidate of picked.value) {
		const { data, error } = await db
			.from('bookings')
			.update({
				staff_id: candidate.staffId,
				starts_at: instantToIso(candidate.times.startsAt),
				ends_at: instantToIso(candidate.times.endsAt),
				blocked_until: instantToIso(candidate.times.blockedUntil),
			})
			.eq('id', booking.bookingId)
			.eq('shop_id', shop.id)
			.eq('status', 'confirmed')
			.select('id');
		if (error?.code === '23P01') continue;
		if (error) throw error;
		if (data.length !== 1) return { ok: false, error: { kind: 'not_active' } };

		const { error: linkError } = await db
			.from('booking_links')
			.update({ expires_at: instantToIso(linkExpiry(candidate.times.startsAt)) })
			.eq('booking_id', booking.bookingId)
			.is('revoked_at', null);
		if (linkError) throw linkError;

		return {
			ok: true,
			value: bookingDetails(shop, {
				serviceName: service.name,
				staffName: staffName(staff, candidate.staffId),
				startsAt: candidate.times.startsAt,
				endsAt: candidate.times.endsAt,
				priceCents: booking.priceCents,
			}),
		};
	}

	const suggestions = await suggestionsNear(
		db,
		shop,
		service,
		staffIds,
		request.startsAt,
		now,
		booking.bookingId,
	);
	return { ok: false, error: { kind: 'taken', suggestions } };
}
