'use client';

import { useEffect, useState } from 'react';
import { bookingMessagesAction } from '@/app/dashboard/bookings/actions';
import {
	isSkipReason,
	MESSAGE_TYPE_LABELS,
	SKIP_REASON_LABELS,
	type BookingMessage,
	type BookingMessageHistory,
} from '@/lib/messaging/types';

function statusLabel(message: BookingMessage): string {
	switch (message.status) {
		case 'queued':
			return 'Scheduled';
		case 'sending':
			return 'Sending';
		case 'sent':
			if (message.deliveryStatus === 'delivered' || message.deliveryStatus === 'read')
				return 'Delivered';
			if (message.deliveryStatus === 'undelivered' || message.deliveryStatus === 'failed')
				return 'Not delivered';
			// Log mode marks messages sent without contacting Twilio.
			return message.deliveryStatus ? 'Sent' : 'Sent (test mode)';
		case 'failed':
			return 'Failed';
		case 'skipped':
			return message.skipReason && isSkipReason(message.skipReason)
				? `Not sent: ${SKIP_REASON_LABELS[message.skipReason]}`
				: 'Not sent';
		case 'cancelled':
			return 'Cancelled';
	}
}

/** Text message history for one booking; refetched when the booking's time or status changes. */
export function BookingMessages({ bookingId, version }: { bookingId: string; version: string }) {
	const [history, setHistory] = useState<BookingMessageHistory | null>(null);

	useEffect(() => {
		let current = true;
		void bookingMessagesAction(bookingId).then((result) => {
			if (current) setHistory(result);
		});
		return () => {
			current = false;
		};
	}, [bookingId, version]);

	if (!history) {
		return <p className="text-sm text-muted-foreground">Loading texts…</p>;
	}

	return (
		<section aria-labelledby="booking-messages-heading" className="grid gap-2">
			<h3 id="booking-messages-heading" className="text-sm font-medium">
				Text messages
			</h3>
			{history.clientConfirmedLabel ? (
				<p className="text-sm">Client confirmed by text · {history.clientConfirmedLabel}</p>
			) : null}
			{history.messages.length === 0 ? (
				<p className="text-sm text-muted-foreground">No texts for this booking.</p>
			) : (
				<ul className="grid gap-1 text-sm" data-testid="booking-messages">
					{history.messages.map((message) => (
						<li key={message.id} className="flex flex-wrap justify-between gap-x-3">
							<span>{MESSAGE_TYPE_LABELS[message.type]}</span>
							<span className="text-muted-foreground">
								{statusLabel(message)} · {message.atLabel}
							</span>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
