import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';
import twilio from 'twilio';
import { getTwilioWebhookBaseUrl } from '@/lib/env';
import type { Db } from '@/lib/shop/settings';

export const STATUS_CALLBACK_PATH = '/api/webhooks/twilio/status';
export const INBOUND_PATH = '/api/webhooks/twilio/inbound';

/** The exact public URL Twilio signed; built from config, never from the Host header. */
export function twilioWebhookUrl(path: string): string {
	return new URL(path, getTwilioWebhookBaseUrl()).toString();
}

/** Form-encoded webhook parameters, or null when the body is not a form. */
export async function readTwilioForm(request: Request): Promise<Record<string, string> | null> {
	if (!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')) {
		return null;
	}
	const params: Record<string, string> = {};
	for (const [key, value] of new URLSearchParams(await request.text())) params[key] = value;
	return params;
}

export function verifyTwilioSignature(
	authToken: string,
	signature: string | null,
	url: string,
	params: Record<string, string>,
): boolean {
	return signature !== null && twilio.validateRequest(authToken, signature, url, params);
}

export type WebhookProvider = 'twilio' | 'stripe';

/** Records a provider event; false means it was already processed. */
export async function recordWebhookEvent(
	db: Db,
	eventId: string,
	provider: WebhookProvider = 'twilio',
): Promise<boolean> {
	const { data, error } = await db
		.from('webhook_events')
		.upsert(
			{ provider, event_id: eventId },
			{ onConflict: 'provider,event_id', ignoreDuplicates: true },
		)
		.select('event_id');
	if (error) throw error;
	return data.length === 1;
}

/** Lets a provider retry reprocess an event whose handling failed. */
export async function forgetWebhookEvent(
	db: Db,
	eventId: string,
	provider: WebhookProvider = 'twilio',
): Promise<void> {
	await db.from('webhook_events').delete().eq('provider', provider).eq('event_id', eventId);
}

/** Constant-time comparison for shared secrets of any length. */
export function secretsMatch(given: string, expected: string): boolean {
	const digest = (value: string) => createHash('sha256').update(value).digest();
	return timingSafeEqual(digest(given), digest(expected));
}

export const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

export function twimlResponse(): Response {
	return new Response(EMPTY_TWIML, {
		headers: { 'Content-Type': 'text/xml', 'Cache-Control': 'no-store' },
	});
}
