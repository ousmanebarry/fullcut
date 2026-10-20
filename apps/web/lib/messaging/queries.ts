// Reads for the dashboard. Callers pass a user-scoped client (RLS applies) and the session's shop.
import type { Db } from '@/lib/shop/settings';
import { formatSlotLabel, instantFromIso, type TimeZone } from '@/lib/time';
import {
	isMessageType,
	type BookingMessageHistory,
	type InboxMessage,
	type MessageStatus,
} from './types';

export async function bookingMessageHistory(
	db: Db,
	shopId: string,
	bookingId: string,
	zone: TimeZone,
): Promise<BookingMessageHistory> {
	const [messages, booking] = await Promise.all([
		db
			.from('scheduled_messages')
			.select('id, type, status, delivery_status, skip_reason, send_at, sent_at')
			.eq('shop_id', shopId)
			.eq('booking_id', bookingId)
			.order('send_at')
			.order('created_at'),
		db
			.from('bookings')
			.select('client_confirmed_at')
			.eq('shop_id', shopId)
			.eq('id', bookingId)
			.maybeSingle(),
	]);
	if (messages.error) throw messages.error;
	if (booking.error) throw booking.error;
	const confirmedAt = booking.data?.client_confirmed_at;
	return {
		clientConfirmedLabel: confirmedAt ? formatSlotLabel(instantFromIso(confirmedAt), zone) : null,
		messages: messages.data.flatMap((row) => {
			if (!isMessageType(row.type)) return [];
			const at = instantFromIso(row.sent_at ?? row.send_at);
			return [
				{
					id: row.id,
					type: row.type,
					status: row.status as MessageStatus,
					deliveryStatus: row.delivery_status,
					skipReason: row.skip_reason,
					at,
					atLabel: formatSlotLabel(at, zone),
				},
			];
		}),
	};
}

export const INBOX_LIMIT = 100;

export async function unhandledReplies(
	db: Db,
	shopId: string,
	zone: TimeZone,
): Promise<InboxMessage[]> {
	const { data, error } = await db
		.from('inbound_messages')
		.select(
			'id, body, from_phone, client_id, created_at, client:clients!inbound_messages_client_same_shop_fk(name)',
		)
		.eq('shop_id', shopId)
		.eq('kind', 'other')
		.is('handled_at', null)
		.order('created_at', { ascending: false })
		.limit(INBOX_LIMIT);
	if (error) throw error;
	return data.map((row) => ({
		id: row.id,
		body: row.body ?? '',
		fromPhone: row.from_phone,
		clientId: row.client_id,
		clientName: row.client?.name ?? null,
		receivedLabel: formatSlotLabel(instantFromIso(row.created_at), zone),
	}));
}
