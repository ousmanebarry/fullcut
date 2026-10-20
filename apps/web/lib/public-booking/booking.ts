import type { StartRejection } from '@/lib/booking/validate-requested-start';
import type { Result } from '@/lib/booking/types';
import { countryForCurrency, normalizePhone } from '@/lib/contact/phone';
import { startDepositCheckout } from '@/lib/payments/checkout';
import type { PaymentGateway } from '@/lib/payments/gateway';
import { HOLD_MINUTES, platformFeeCents } from '@/lib/payments/policy';
import type { Db } from '@/lib/shop/settings';
import {
	addMinutes,
	formatLongDateTime,
	instantToIso,
	localDateOf,
	plusDays,
	type Instant,
} from '@/lib/time';
import { candidatesForStart, dateWindow, staffIdsFor, suggestionsNear } from './availability';
import {
	loadActiveServices,
	loadActiveStaff,
	loadSchedulingContext,
	serviceDeposit,
	type BookableService,
	type BookableStaff,
	type BookingShop,
} from './data';
import { bookingReference, hashToken, issueToken, linkExpiry, manageUrl } from './links';
import type { BookingBody } from './schemas';
import type { BookingDetails, PublicSlot } from './types';

export type BookingFailure =
	| { kind: 'invalid'; fieldErrors: Record<string, string> }
	| { kind: 'not_found' }
	| { kind: 'unavailable'; reason: StartRejection; suggestions: PublicSlot[] }
	| { kind: 'taken'; suggestions: PublicSlot[] }
	| { kind: 'too_many' }
	| { kind: 'not_active' }
	| { kind: 'cancel_window_passed' }
	| { kind: 'deposit_changed'; depositCents: number }
	| { kind: 'payment_unavailable' };

type CreateBookingError = Extract<
	BookingFailure,
	{
		kind:
			| 'not_found'
			| 'unavailable'
			| 'taken'
			| 'too_many'
			| 'deposit_changed'
			| 'payment_unavailable';
	}
>;

export interface CreatedBooking {
	bookingId: string;
	reference: string;
	token: string;
	details: BookingDetails;
	/** Where to pay the deposit; null when none is due and the booking is already confirmed. */
	checkoutUrl: string | null;
}

export interface BookingPayments {
	gateway: PaymentGateway | null;
	siteUrl: string;
}

export interface CreateBookingInput extends Omit<BookingBody, 'website'> {
	phoneE164: string;
	source: string;
}

/** Normalises the typed phone with the shop's country; returns field errors if invalid. */
export function parseClientPhone(
	shop: BookingShop,
	phone: string,
): Result<string, Record<string, string>> {
	const e164 = normalizePhone(phone, countryForCurrency(shop.currency));
	return e164
		? { ok: true, value: e164 }
		: { ok: false, error: { phone: 'Enter a valid mobile number.' } };
}

/**
 * Creates a booking following the booking-engine order: server-loaded service and staff,
 * server-computed times, a friendly pre-check, then the atomic DB write (23P01 → taken). When a deposit
 * is due the booking is a `pending` hold and the client is sent to Stripe Checkout to pay it.
 */
export async function createPublicBooking(
	db: Db,
	shop: BookingShop,
	input: CreateBookingInput,
	now: Instant,
	payments: BookingPayments,
): Promise<Result<CreatedBooking, CreateBookingError>> {
	const [services, staff] = await Promise.all([
		loadActiveServices(db, shop.id),
		loadActiveStaff(db, shop.id),
	]);
	const service = services.find((s) => s.id === input.serviceId);
	const staffIds = staffIdsFor(input.staffId, staff);
	if (!service || !staffIds || staffIds.length === 0) return fail({ kind: 'not_found' });

	// The client must have seen the exact deposit before we take it.
	const depositCents = serviceDeposit(shop, service, payments.gateway !== null);
	if (depositCents !== input.expectedDepositCents) {
		return fail({ kind: 'deposit_changed', depositCents });
	}
	const holdUntil = depositCents > 0 ? addMinutes(now, HOLD_MINUTES) : null;
	const feeCents = depositCents > 0 ? platformFeeCents() : 0;

	const ctx = await loadDayContext(db, shop, service, staffIds, input.startsAt, now);
	const picked = candidatesForStart(ctx, staffIds, input.startsAt);
	if (!picked.ok) {
		const suggestions = await suggestionsNear(db, shop, service, staffIds, input.startsAt, now);
		return fail({ kind: 'unavailable', reason: picked.error, suggestions });
	}

	const token = issueToken();
	for (const candidate of picked.value) {
		const { data, error } = await db
			.rpc('create_public_booking', {
				p_shop_id: shop.id,
				p_staff_id: candidate.staffId,
				p_service_id: service.id,
				p_starts_at: instantToIso(candidate.times.startsAt),
				p_ends_at: instantToIso(candidate.times.endsAt),
				p_blocked_until: instantToIso(candidate.times.blockedUntil),
				p_price_cents: service.priceCents,
				p_source: input.source,
				p_client_name: input.name,
				p_phone_e164: input.phoneE164,
				p_email: input.email ?? '',
				p_notes: input.notes ?? '',
				p_marketing_opt_in: input.marketingOptIn,
				p_token_hash: hashToken(token),
				p_link_expires_at: instantToIso(linkExpiry(candidate.times.startsAt)),
				p_deposit_cents: depositCents,
				p_platform_fee_cents: feeCents,
				// Ignored by the RPC when there is no deposit.
				p_pending_expires_at: instantToIso(holdUntil ?? now),
			})
			.single();

		if (!error) {
			const details = bookingDetails(shop, {
				serviceName: service.name,
				staffName: staffName(staff, candidate.staffId),
				startsAt: candidate.times.startsAt,
				endsAt: candidate.times.endsAt,
				priceCents: service.priceCents,
				depositCents,
			});
			let checkoutUrl: string | null = null;
			if (holdUntil && payments.gateway) {
				try {
					checkoutUrl = await startDepositCheckout(db, payments.gateway, {
						shopId: shop.id,
						bookingId: data.booking_id,
						amountCents: depositCents,
						platformFeeCents: feeCents,
						currency: shop.currency,
						description: `Deposit: ${service.name} at ${shop.name}, ${details.label}`,
						expiresAt: holdUntil,
						manageUrl: manageUrl(payments.siteUrl, token),
						email: input.email ?? null,
					});
				} catch (cause) {
					console.error('Could not start deposit checkout', cause);
					return fail({ kind: 'payment_unavailable' });
				}
			}
			return {
				ok: true,
				value: {
					bookingId: data.booking_id,
					reference: bookingReference(data.booking_id),
					token,
					details,
					checkoutUrl,
				},
			};
		}
		if (error.code === '23P01') continue;
		if (error.code === 'FC001') return fail({ kind: 'too_many' });
		// Stripe stopped accepting charges for the shop since the page loaded.
		if (error.code === 'FC002') return fail({ kind: 'deposit_changed', depositCents: 0 });
		if (error.code === '23503') return fail({ kind: 'not_found' });
		throw error;
	}

	const suggestions = await suggestionsNear(db, shop, service, staffIds, input.startsAt, now);
	return fail({ kind: 'taken', suggestions });
}

export async function loadDayContext(
	db: Db,
	shop: BookingShop,
	service: BookableService,
	staffIds: readonly string[],
	startsAt: Instant,
	now: Instant,
	excludeBookingId?: string,
) {
	const date = localDateOf(startsAt, shop.timezone);
	return loadSchedulingContext(
		db,
		shop,
		service,
		staffIds,
		dateWindow(plusDays(date, -1), plusDays(date, 1), shop.timezone),
		now,
		excludeBookingId,
	);
}

export function bookingDetails(
	shop: BookingShop,
	booking: {
		serviceName: string;
		staffName: string;
		startsAt: Instant;
		endsAt: Instant;
		priceCents: number;
		depositCents: number;
	},
): BookingDetails {
	return {
		shopName: shop.name,
		shopAddress: shop.address,
		serviceName: booking.serviceName,
		staffName: booking.staffName,
		startsAt: instantToIso(booking.startsAt),
		endsAt: instantToIso(booking.endsAt),
		label: formatLongDateTime(booking.startsAt, shop.timezone),
		durationMinutes: Math.round((booking.endsAt - booking.startsAt) / 60_000),
		priceCents: booking.priceCents,
		depositCents: booking.depositCents,
		currency: shop.currency,
		timezone: shop.timezone,
	};
}

export function staffName(staff: readonly BookableStaff[], staffId: string): string {
	return staff.find((s) => s.id === staffId)?.displayName ?? '';
}

function fail(error: CreateBookingError): Result<never, CreateBookingError> {
	return { ok: false, error };
}
