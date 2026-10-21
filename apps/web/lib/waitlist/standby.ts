import 'server-only';
import type { BookingShop } from '@/lib/public-booking/data';
import type { Db } from '@/lib/shop/settings';
import { formatSlotLabel, type Instant } from '@/lib/time';
import { matchWaitlist } from './match';
import { loadMatchInput, loadWaitlistSettings } from './refill';

export interface StandbyCandidate {
	clientId: string;
	clientName: string;
	phone: string | null;
	serviceName: string;
	startsLabel: string;
}

const STANDBY_LIMIT = 3;

/**
 * Waitlisted clients who would be offered this booking's time if it were freed: the same matcher the
 * refill job uses, run as a preview while the booking still holds the slot.
 */
export async function standbyCandidates(
	db: Db,
	shop: BookingShop,
	booking: { id: string; staffId: string; startsAt: Instant; blockedUntil: Instant },
	now: Instant,
): Promise<StandbyCandidate[]> {
	const settings = await loadWaitlistSettings(db, shop.id);
	if (!settings?.enabled || booking.startsAt <= now) return [];

	const input = await loadMatchInput(
		db,
		shop,
		settings,
		null,
		{ staffId: booking.staffId, startsAt: booking.startsAt, endsAt: booking.blockedUntil },
		now,
		booking.id,
	);
	const matches = matchWaitlist(input).slice(0, STANDBY_LIMIT);
	if (matches.length === 0) return [];

	const { data, error } = await db
		.from('clients')
		.select('id, name, phone_e164')
		.eq('shop_id', shop.id)
		.in(
			'id',
			matches.map((m) => m.clientId),
		);
	if (error) throw error;
	const clients = new Map(data.map((c) => [c.id, c]));
	return matches.map((m) => ({
		clientId: m.clientId,
		clientName: clients.get(m.clientId)?.name ?? 'Client',
		phone: clients.get(m.clientId)?.phone_e164 ?? null,
		serviceName: input.services.get(m.serviceId)?.name ?? '',
		startsLabel: formatSlotLabel(m.startsAt, shop.timezone),
	}));
}
