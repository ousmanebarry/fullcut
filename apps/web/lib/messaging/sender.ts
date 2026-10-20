import 'server-only';
import twilio from 'twilio';
import { getMessagingMode, getTwilioEnv, type MessagingMode } from '@/lib/env';

export interface OutgoingSms {
	to: string;
	body: string;
	statusCallback: string | null;
}

export type SendResult =
	| { ok: true; sid: string | null; deliveryStatus: string | null }
	| { ok: false; retryable: boolean; code: number | null; message: string };

export interface MessageSender {
	mode: MessagingMode;
	send(sms: OutgoingSms): Promise<SendResult>;
}

/** Twilio: the recipient has replied STOP to this sender. */
export const TWILIO_UNSUBSCRIBED = 21610;

export function maskPhone(phone: string): string {
	return phone.length > 6 ? `${phone.slice(0, 5)}•••${phone.slice(-2)}` : '•••';
}

/** Dev/test sender: logs a masked line and never contacts Twilio. Message text is not logged. */
export function createLogSender(log: (line: string) => void = console.info): MessageSender {
	return {
		mode: 'log',
		async send(sms) {
			log(`[sms:log] to ${maskPhone(sms.to)} (${sms.body.length} chars)`);
			return { ok: true, sid: null, deliveryStatus: null };
		},
	};
}

export function classifyTwilioError(error: unknown): Extract<SendResult, { ok: false }> {
	if (error instanceof twilio.RestException) {
		return {
			ok: false,
			retryable: error.status === 429 || error.status >= 500,
			code: error.code ?? null,
			message: `twilio_${error.status}${error.code ? `_${error.code}` : ''}`,
		};
	}
	return { ok: false, retryable: true, code: null, message: 'network_error' };
}

export function createTwilioSender(): MessageSender {
	const env = getTwilioEnv();
	const client = twilio(env.accountSid, env.authToken);
	return {
		mode: 'twilio',
		async send(sms) {
			try {
				const message = await client.messages.create({
					to: sms.to,
					body: sms.body,
					messagingServiceSid: env.messagingServiceSid,
					...(sms.statusCallback ? { statusCallback: sms.statusCallback } : {}),
				});
				return { ok: true, sid: message.sid, deliveryStatus: message.status };
			} catch (error) {
				return classifyTwilioError(error);
			}
		},
	};
}

export function getMessageSender(): MessageSender {
	return getMessagingMode() === 'twilio' ? createTwilioSender() : createLogSender();
}
