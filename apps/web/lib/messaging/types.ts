// Client-safe messaging types and labels (also used by dashboard client components).

export const MESSAGE_TYPES = [
	'confirmation',
	'reminder',
	'confirm_request',
	'rescheduled',
	'cancelled',
] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

/** Texts about a waitlist entry or offer rather than a booking. */
export const WAITLIST_MESSAGE_TYPES = ['waitlist_joined', 'waitlist_offer'] as const;
export type WaitlistMessageType = (typeof WAITLIST_MESSAGE_TYPES)[number];

export const MESSAGE_STATUSES = [
	'queued',
	'sending',
	'sent',
	'failed',
	'skipped',
	'cancelled',
] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export type SkipReason =
	| 'opted_out'
	| 'no_phone'
	| 'invalid_phone'
	| 'booking_inactive'
	| 'type_disabled'
	| 'demo_shop'
	| 'too_late'
	| 'entry_inactive'
	| 'offer_closed'
	| 'quiet_hours';

export const MESSAGE_TYPE_LABELS: Record<MessageType, string> = {
	confirmation: 'Booking confirmation',
	reminder: 'Reminder',
	confirm_request: 'Confirmation request',
	rescheduled: 'Rescheduled notice',
	cancelled: 'Cancellation notice',
};

export const SKIP_REASON_LABELS: Record<SkipReason, string> = {
	opted_out: 'client replied STOP',
	no_phone: 'no phone number',
	invalid_phone: 'phone number not textable',
	booking_inactive: 'booking changed',
	type_disabled: 'turned off in settings',
	demo_shop: 'demo shop',
	too_late: 'too late to send',
	entry_inactive: 'left the waitlist',
	offer_closed: 'offer no longer open',
	quiet_hours: 'quiet hours',
};

export function isMessageType(value: string): value is MessageType {
	return (MESSAGE_TYPES as readonly string[]).includes(value);
}

export function isWaitlistMessageType(value: string): value is WaitlistMessageType {
	return (WAITLIST_MESSAGE_TYPES as readonly string[]).includes(value);
}

export function isSkipReason(value: string): value is SkipReason {
	return value in SKIP_REASON_LABELS;
}

/** One row of a booking's message history, as shown in the booking drawer. */
export interface BookingMessage {
	id: string;
	type: MessageType;
	status: MessageStatus;
	deliveryStatus: string | null;
	skipReason: string | null;
	/** Epoch ms of the send (or planned send) time. */
	at: number;
	atLabel: string;
}

export interface BookingMessageHistory {
	messages: BookingMessage[];
	/** When the client replied YES, formatted in shop time. */
	clientConfirmedLabel: string | null;
}

/** An unhandled inbound reply, as shown in the dashboard inbox. */
export interface InboxMessage {
	id: string;
	body: string;
	fromPhone: string | null;
	clientId: string | null;
	clientName: string | null;
	receivedLabel: string;
}
