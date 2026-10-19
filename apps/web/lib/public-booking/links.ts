import { createHash, randomBytes } from 'node:crypto';
import { addMinutes, type Instant } from '@/lib/time';

const LINK_VALID_AFTER_APPOINTMENT_MINUTES = 7 * 24 * 60;

/** 256-bit random manage-link token, base64url (43 chars). */
export function issueToken(): string {
	return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

export function linkExpiry(startsAt: Instant): Instant {
	return addMinutes(startsAt, LINK_VALID_AFTER_APPOINTMENT_MINUTES);
}

/** Short code a client can quote to the shop; not a secret and not unique on its own. */
export function bookingReference(bookingId: string): string {
	return bookingId.replace(/-/g, '').slice(0, 8).toUpperCase();
}

export function manageUrl(siteUrl: string, token: string): string {
	return new URL(`/b/${token}`, siteUrl).toString();
}
