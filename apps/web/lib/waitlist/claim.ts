import 'server-only';
import type { Result } from '@/lib/booking/types';
import { bookingDetails } from '@/lib/public-booking/booking';
import { loadShopById, type BookingShop } from '@/lib/public-booking/data';
import { bookingReference, hashToken, issueToken, manageUrl } from '@/lib/public-booking/links';
import { TOKEN_PATTERN } from '@/lib/public-booking/schemas';
import type { BookingCreated, BookingDetails, OfferClosedReason } from '@/lib/public-booking/types';
import type { Db } from '@/lib/shop/settings';
import { formatLocalTime, instantFromIso, type Instant } from '@/lib/time';

export type OfferState = 'open' | OfferClosedReason;

export interface ClaimableOffer {
	state: OfferState;
	shop: BookingShop;
	booking: BookingDetails;
	expiresLabel: string;
}

/** The offer behind a claim token, or null for unknown, malformed or forged tokens. */
export async function findOfferByToken(
	db: Db,
	token: string,
	now: Instant,
): Promise<ClaimableOffer | null> {
	if (!TOKEN_PATTERN.test(token)) return null;
	const { data, error } = await db
		.from('slot_offers')
		.select(
			'shop_id, status, starts_at, ends_at, expires_at, entry:waitlist_entries!slot_offers_entry_same_shop_fk(status), service:services!slot_offers_service_same_shop_fk(name, price_cents), staff:staff!slot_offers_staff_same_shop_fk(display_name)',
		)
		.eq('token_hash', hashToken(token))
		.maybeSingle();
	if (error) throw error;
	if (!data) return null;
	const shop = await loadShopById(db, data.shop_id);
	if (!shop) return null;

	const expiresAt = instantFromIso(data.expires_at);
	return {
		state: offerState(data.status, data.entry.status, expiresAt, now),
		shop,
		booking: bookingDetails(shop, {
			serviceName: data.service.name,
			staffName: data.staff.display_name,
			startsAt: instantFromIso(data.starts_at),
			endsAt: instantFromIso(data.ends_at),
			priceCents: data.service.price_cents,
		}),
		expiresLabel: formatLocalTime(expiresAt, shop.timezone),
	};
}

function offerState(
	status: string,
	entryStatus: string,
	expiresAt: Instant,
	now: Instant,
): OfferState {
	if (status === 'claimed') return 'claimed';
	if (status === 'taken' || status === 'withdrawn') return 'taken';
	if (status === 'expired' || expiresAt <= now) return 'expired';
	if (entryStatus !== 'active') return 'inactive';
	return 'open';
}

export type ClaimFailure =
	{ kind: 'invalid' } | { kind: 'closed'; reason: OfferClosedReason } | { kind: 'too_many' };

/** Books the offered slot through the normal public booking path; the database settles races. */
export async function claimOffer(
	db: Db,
	token: string,
	siteUrl: string,
	now: Instant,
): Promise<Result<BookingCreated, ClaimFailure>> {
	if (!TOKEN_PATTERN.test(token)) return { ok: false, error: { kind: 'invalid' } };
	const manageToken = issueToken();
	const { data, error } = await db
		.rpc('claim_slot_offer', {
			p_token_hash: hashToken(token),
			p_manage_token_hash: hashToken(manageToken),
		})
		.single();
	if (error) throw error;

	switch (data.outcome) {
		case 'booked': {
			const offer = await findOfferByToken(db, token, now);
			if (!offer) throw new Error('claimed offer vanished');
			return {
				ok: true,
				value: {
					reference: bookingReference(data.booking_id),
					manageUrl: manageUrl(siteUrl, manageToken),
					booking: offer.booking,
				},
			};
		}
		case 'too_many':
			return { ok: false, error: { kind: 'too_many' } };
		case 'taken':
		case 'expired':
		case 'claimed':
		case 'inactive':
			return { ok: false, error: { kind: 'closed', reason: data.outcome } };
		default:
			return { ok: false, error: { kind: 'invalid' } };
	}
}
