import { TOKEN_PATTERN } from '@/lib/public-booking/schemas';
import { hashToken } from '@/lib/public-booking/links';
import type { Db } from '@/lib/shop/settings';
import { instantToIso, type Instant } from '@/lib/time';
import { ENTRY_STATUSES, parseWindows, type EntryStatus, type TimeWindow } from './types';

export interface ManagedEntry {
	entryId: string;
	status: EntryStatus;
	shop: { name: string; slug: string; phone: string | null; timezone: string };
	serviceName: string;
	staffName: string | null;
	earliestDate: string;
	latestDate: string;
	timeWindows: TimeWindow[];
}

const isEntryStatus = (value: string): value is EntryStatus =>
	(ENTRY_STATUSES as readonly string[]).includes(value);

/** The entry behind a view/leave token; unknown, tampered, expired and revoked all give null. */
export async function findEntryByToken(
	db: Db,
	token: string,
	now: Instant,
): Promise<ManagedEntry | null> {
	if (!TOKEN_PATTERN.test(token)) return null;
	const { data: link, error: linkError } = await db
		.from('waitlist_links')
		.select('waitlist_entry_id, shop_id')
		.eq('token_hash', hashToken(token))
		.is('revoked_at', null)
		.gt('expires_at', instantToIso(now))
		.maybeSingle();
	if (linkError) throw linkError;
	if (!link) return null;

	const { data, error } = await db
		.from('waitlist_entries')
		.select(
			'id, status, earliest_date, latest_date, time_windows, service:services!waitlist_entries_service_same_shop_fk(name), staff:staff!waitlist_entries_staff_same_shop_fk(display_name), shop:shops!waitlist_entries_shop_id_fkey(name, slug, phone, timezone)',
		)
		.eq('shop_id', link.shop_id)
		.eq('id', link.waitlist_entry_id)
		.maybeSingle();
	if (error) throw error;
	if (!data || !isEntryStatus(data.status)) return null;

	return {
		entryId: data.id,
		status: data.status,
		shop: data.shop,
		serviceName: data.service.name,
		staffName: data.staff?.display_name ?? null,
		earliestDate: data.earliest_date,
		latestDate: data.latest_date,
		timeWindows: parseWindows(data.time_windows),
	};
}

export type LeaveResult = 'left' | 'not_active';

/** Cancels the entry; the database trigger withdraws any open offers. */
export async function leaveWaitlist(db: Db, entry: ManagedEntry): Promise<LeaveResult> {
	const { data, error } = await db
		.from('waitlist_entries')
		.update({ status: 'cancelled' })
		.eq('id', entry.entryId)
		.eq('status', 'active')
		.select('id');
	if (error) throw error;
	return data.length > 0 ? 'left' : 'not_active';
}
