// Client-book reads. Callers pass a user-scoped client (RLS applies) and the shop derived on the server.
import type { MemberRole } from '@/lib/auth/roles';
import { isOwner } from '@/lib/auth/roles';
import { BOOKING_COLUMNS, toDashboardBooking } from '@/lib/dashboard/queries';
import type { DashboardBooking } from '@/lib/dashboard/types';
import { loadActiveServices, loadActiveStaff, type BookingShop } from '@/lib/public-booking/data';
import type { Db } from '@/lib/shop/settings';
import {
	formatShortDate,
	formatSlotLabel,
	instantFromIso,
	type Instant,
	type TimeZone,
} from '@/lib/time';
import type { ClientListParams } from './schemas';
import { clientSearchPattern } from './search';
import { medianIntervalDays, usualBooking } from './stats';
import type { ClientListPage, ClientNoteView, ClientProfile, DuplicateClient } from './types';

export const CLIENT_PAGE_SIZE = 25;
const HISTORY_LIMIT = 500;
export const PAST_SHOWN = 50;

const dateLabel = (iso: string | null, zone: TimeZone) =>
	iso ? formatShortDate(instantFromIso(iso), zone) : null;

/** One page of the shop's (non-deleted) clients with visit stats. */
export async function listClients(
	db: Db,
	shop: BookingShop,
	params: ClientListParams,
): Promise<ClientListPage> {
	let request = db
		.from('client_stats')
		.select('id, name, phone_e164, visits, no_shows, last_visit_at, next_booking_at', {
			count: 'exact',
		})
		.eq('shop_id', shop.id)
		.is('anonymised_at', null);
	if (params.q) {
		const pattern = clientSearchPattern(params.q);
		request =
			'phone' in pattern
				? request.like('phone_e164', pattern.phone)
				: request.ilike('name', pattern.name);
	}
	if (params.sort === 'last_visit') {
		request = request.order('last_visit_at', { ascending: false, nullsFirst: false });
	} else if (params.sort === 'visits') {
		request = request.order('visits', { ascending: false });
	}
	const from = (params.page - 1) * CLIENT_PAGE_SIZE;
	const { data, count, error } = await request
		.order('name')
		.order('id')
		.range(from, from + CLIENT_PAGE_SIZE - 1);
	if (error) throw error;

	const total = count ?? data.length;
	return {
		total,
		page: params.page,
		pageCount: Math.max(1, Math.ceil(total / CLIENT_PAGE_SIZE)),
		rows: data.map((row) => ({
			id: row.id ?? '',
			name: row.name ?? '',
			phone: row.phone_e164,
			visits: row.visits ?? 0,
			noShows: row.no_shows ?? 0,
			lastVisitLabel: dateLabel(row.last_visit_at, shop.timezone),
			nextBookingLabel: row.next_booking_at
				? formatSlotLabel(instantFromIso(row.next_booking_at), shop.timezone)
				: null,
		})),
	};
}

/** Name, number and bookings count of another live client holding `phoneE164`. */
export async function findClientByPhone(
	db: Db,
	shopId: string,
	phoneE164: string,
): Promise<DuplicateClient | null> {
	const { data, error } = await db
		.from('client_stats')
		.select('id, name, phone_e164, total_bookings')
		.eq('shop_id', shopId)
		.eq('phone_e164', phoneE164)
		.maybeSingle();
	if (error) throw error;
	if (!data?.id) return null;
	return {
		id: data.id,
		name: data.name ?? '',
		phone: data.phone_e164 ?? phoneE164,
		totalBookings: data.total_bookings ?? 0,
	};
}

async function loadNotes(
	db: Db,
	shopId: string,
	clientId: string,
	viewer: MemberRole & { userId: string },
	zone: TimeZone,
): Promise<ClientNoteView[]> {
	const [notes, members] = await Promise.all([
		db
			.from('client_notes')
			.select('id, body, author_user_id, created_at')
			.eq('shop_id', shopId)
			.eq('client_id', clientId)
			.order('created_at', { ascending: false })
			.order('id'),
		db
			.from('shop_members')
			.select('user_id, role, staff:staff!shop_members_staff_same_shop_fk(display_name)')
			.eq('shop_id', shopId),
	]);
	if (notes.error) throw notes.error;
	if (members.error) throw members.error;

	const names = new Map(
		members.data.map((m) => [
			m.user_id,
			m.staff?.display_name ?? (m.role === 'owner' ? 'Owner' : 'Staff'),
		]),
	);
	return notes.data.map((note) => ({
		id: note.id,
		body: note.body,
		authorName: (note.author_user_id && names.get(note.author_user_id)) || 'Former member',
		createdLabel: formatSlotLabel(instantFromIso(note.created_at), zone),
		canDelete: isOwner(viewer) || note.author_user_id === viewer.userId,
	}));
}

const isUpcoming = (b: DashboardBooking, now: Instant) =>
	(b.status === 'confirmed' || b.status === 'pending') && b.endsAtMs > now;

export async function loadClientProfile(
	db: Db,
	shop: BookingShop,
	viewer: MemberRole & { userId: string },
	clientId: string,
	now: Instant,
): Promise<ClientProfile | null> {
	const [client, stats, history, notes, services, staff] = await Promise.all([
		db
			.from('clients')
			.select(
				'id, name, phone_e164, email, first_source, created_at, anonymised_at, marketing_opt_in, marketing_opt_in_at, sms_opted_out',
			)
			.eq('shop_id', shop.id)
			.eq('id', clientId)
			.maybeSingle(),
		db
			.from('client_stats')
			.select('visits, no_shows, cancellations, total_bookings, avg_spend_cents')
			.eq('shop_id', shop.id)
			.eq('id', clientId)
			.maybeSingle(),
		db
			.from('bookings')
			.select(BOOKING_COLUMNS)
			.eq('shop_id', shop.id)
			.eq('client_id', clientId)
			.order('starts_at', { ascending: false })
			.order('id')
			.limit(HISTORY_LIMIT),
		loadNotes(db, shop.id, clientId, viewer, shop.timezone),
		loadActiveServices(db, shop.id),
		loadActiveStaff(db, shop.id),
	]);
	if (client.error) throw client.error;
	if (stats.error) throw stats.error;
	if (history.error) throw history.error;
	if (!client.data) return null;

	const row = client.data;
	const bookings = history.data.map((b) => toDashboardBooking(b, shop.timezone));
	const upcoming = bookings.filter((b) => isUpcoming(b, now)).reverse();
	const past = bookings.filter((b) => !isUpcoming(b, now));
	const visits = bookings.filter((b) => b.status === 'completed').map((b) => b.startsAtMs);

	return {
		id: row.id,
		name: row.name,
		phone: row.phone_e164,
		email: row.email,
		firstSource: row.first_source,
		createdLabel: formatShortDate(instantFromIso(row.created_at), shop.timezone),
		anonymised: row.anonymised_at !== null,
		marketingOptIn: row.marketing_opt_in,
		marketingOptInLabel: dateLabel(row.marketing_opt_in_at, shop.timezone),
		smsOptedOut: row.sms_opted_out,
		stats: {
			visits: stats.data?.visits ?? 0,
			noShows: stats.data?.no_shows ?? 0,
			cancellations: stats.data?.cancellations ?? 0,
			totalBookings: stats.data?.total_bookings ?? 0,
			avgSpendCents: stats.data?.avg_spend_cents ?? null,
			medianIntervalDays: medianIntervalDays(visits),
		},
		upcoming,
		past: past.slice(0, PAST_SHOWN),
		notes,
		bookAgain: usualBooking(bookings, {
			serviceIds: new Set(services.map((s) => s.id)),
			staffIds: new Set(staff.map((s) => s.id)),
		}),
	};
}
