import { describe, expect, it } from 'vitest';
import type { Slot } from '@/lib/booking/types';
import {
	candidatesForStart,
	nearestSlots,
	periodOf,
	toPublicSlot,
} from '@/lib/public-booking/availability';
import { buildIcs, escapeText, icsUtc } from '@/lib/public-booking/ics';
import { bookingReference, hashToken, issueToken, manageUrl } from '@/lib/public-booking/links';
import { clientIp, rateLimitKey } from '@/lib/public-booking/rate-limit';
import {
	availabilityQuerySchema,
	bookingBodySchema,
	rescheduleBodySchema,
	sourceFromParam,
	TOKEN_PATTERN,
} from '@/lib/public-booking/schemas';
import { at, booking, context, rule, toronto } from '../booking/fixtures';

const SERVICE = '10000000-0000-4000-8000-000000000101';
const validBody = {
	serviceId: SERVICE,
	staffId: 'any',
	startsAt: '2026-03-10T14:00:00Z',
	name: '  Pat Public ',
	phone: '(555) 010-0000',
};

describe('availabilityQuerySchema', () => {
	it('accepts a range of up to 7 days and defaults staff to any', () => {
		const parsed = availabilityQuerySchema.parse({
			serviceId: SERVICE,
			from: '2026-03-09',
			to: '2026-03-15',
		});
		expect(parsed.staffId).toBe('any');
	});

	it('rejects more than 7 days, reversed ranges and bad dates', () => {
		const base = { serviceId: SERVICE, staffId: 'any' };
		expect(
			availabilityQuerySchema.safeParse({ ...base, from: '2026-03-09', to: '2026-03-16' }).success,
		).toBe(false);
		expect(
			availabilityQuerySchema.safeParse({ ...base, from: '2026-03-09', to: '2026-03-08' }).success,
		).toBe(false);
		expect(
			availabilityQuerySchema.safeParse({ ...base, from: '2026-02-30', to: '2026-03-01' }).success,
		).toBe(false);
		expect(
			availabilityQuerySchema.safeParse({
				...base,
				serviceId: 'x',
				from: '2026-03-09',
				to: '2026-03-09',
			}).success,
		).toBe(false);
	});
});

describe('bookingBodySchema', () => {
	it('trims text, lowercases email and drops empty optionals', () => {
		const parsed = bookingBodySchema.parse({
			...validBody,
			email: ' Pat@Example.COM ',
			notes: '   ',
		});
		expect(parsed.name).toBe('Pat Public');
		expect(parsed.email).toBe('pat@example.com');
		expect(parsed.notes).toBeUndefined();
		expect(parsed.marketingOptIn).toBe(false);
		expect(parsed.startsAt).toBe(at('2026-03-10T14:00:00Z'));
	});

	it('requires an offset on the start time and a valid email', () => {
		expect(
			bookingBodySchema.safeParse({ ...validBody, startsAt: '2026-03-10T14:00:00' }).success,
		).toBe(false);
		expect(bookingBodySchema.safeParse({ ...validBody, email: 'nope' }).success).toBe(false);
		expect(bookingBodySchema.safeParse({ ...validBody, name: ' ' }).success).toBe(false);
		expect(bookingBodySchema.safeParse({ ...validBody, notes: 'x'.repeat(501) }).success).toBe(
			false,
		);
	});

	it('rejects tokens that are not 43 base64url characters', () => {
		const ok = { token: issueToken(), staffId: 'any', startsAt: '2026-03-10T14:00:00Z' };
		expect(rescheduleBodySchema.safeParse(ok).success).toBe(true);
		expect(rescheduleBodySchema.safeParse({ ...ok, token: `${ok.token}x` }).success).toBe(false);
		expect(
			rescheduleBodySchema.safeParse({ ...ok, token: ok.token.replace(/.$/, '+') }).success,
		).toBe(false);
	});
});

describe('sourceFromParam', () => {
	it('keeps simple source tags and falls back to direct', () => {
		expect(sourceFromParam('Instagram')).toBe('instagram');
		expect(sourceFromParam('referral:ab12')).toBe('referral:ab12');
		expect(sourceFromParam(null)).toBe('direct');
		expect(sourceFromParam('')).toBe('direct');
		expect(sourceFromParam('<script>')).toBe('direct');
		expect(sourceFromParam('x'.repeat(41))).toBe('direct');
	});
});

describe('slots for the public page', () => {
	it('groups times into morning, afternoon and evening', () => {
		expect(periodOf(11 * 60 + 59)).toBe('morning');
		expect(periodOf(12 * 60)).toBe('afternoon');
		expect(periodOf(16 * 60 + 59)).toBe('afternoon');
		expect(periodOf(17 * 60)).toBe('evening');
	});

	it('maps a slot to shop-local date, time and period', () => {
		const slot: Slot = { startsAt: at('2026-03-10T21:30:00Z'), staffId: 's1', localLabel: 'x' };
		expect(toPublicSlot(slot, toronto)).toEqual({
			startsAt: '2026-03-10T21:30:00.000Z',
			staffId: 's1',
			label: 'x',
			date: '2026-03-10',
			time: '5:30 PM',
			period: 'evening',
		});
	});

	it('suggests the nearest other slots in time order', () => {
		const slots = ['13:00', '13:30', '14:00', '14:30', '16:00', '18:00'].map((t): Slot => ({
			startsAt: at(`2026-03-10T${t}:00Z`),
			staffId: 's',
			localLabel: t,
		}));
		const picked = nearestSlots(slots, at('2026-03-10T14:00:00Z'), 3).map((s) => s.localLabel);
		expect(picked).toEqual(['13:00', '13:30', '14:30']);
	});
});

describe('candidatesForStart', () => {
	// Tuesday 2026-03-10, 09:00–17:00 Toronto (UTC-4) for both stylists.
	const ctx = context({
		rules: [rule('a', 2, '09:00', '17:00'), rule('b', 2, '09:00', '17:00')],
	});

	it('returns every free stylist, preferring the least-booked one', () => {
		const busyA = context({
			...ctx,
			bookings: [booking('a', '2026-03-10T13:00:00Z', '2026-03-10T13:30:00Z')],
		});
		const result = candidatesForStart(busyA, ['a', 'b'], at('2026-03-10T15:00:00Z'));
		expect(result.ok && result.value.map((c) => c.staffId)).toEqual(['b', 'a']);
	});

	it('skips a stylist who is busy at that time', () => {
		const busyA = context({
			...ctx,
			bookings: [booking('a', '2026-03-10T15:00:00Z', '2026-03-10T15:30:00Z')],
		});
		const result = candidatesForStart(busyA, ['a', 'b'], at('2026-03-10T15:00:00Z'));
		expect(result.ok && result.value.map((c) => c.staffId)).toEqual(['b']);
	});

	it('reports a conflict ahead of being outside one stylist’s hours', () => {
		const mixed = context({
			rules: [rule('a', 2, '09:00', '17:00')],
			bookings: [booking('a', '2026-03-10T15:00:00Z', '2026-03-10T15:30:00Z')],
		});
		expect(candidatesForStart(mixed, ['a', 'b'], at('2026-03-10T15:00:00Z'))).toEqual({
			ok: false,
			error: 'conflict',
		});
	});

	it('reports staff-independent rejections such as lead time', () => {
		expect(candidatesForStart(ctx, ['a', 'b'], at('2026-03-01T13:00:00Z'))).toEqual({
			ok: false,
			error: 'too_soon',
		});
	});
});

describe('manage links', () => {
	it('issues unguessable tokens and stores only a hex digest', () => {
		const token = issueToken();
		expect(token).toMatch(TOKEN_PATTERN);
		expect(issueToken()).not.toBe(token);
		expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
		expect(hashToken(token)).toBe(hashToken(token));
	});

	it('builds the manage URL and a short reference', () => {
		expect(manageUrl('https://fullcut.ca', 'abc')).toBe('https://fullcut.ca/b/abc');
		expect(bookingReference('3f2a9c1d-0000-4000-8000-000000000000')).toBe('3F2A9C1D');
	});
});

describe('rate limiting helpers', () => {
	it('reads the first forwarded IP, then x-real-ip', () => {
		expect(clientIp(new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }))).toBe(
			'203.0.113.7',
		);
		expect(clientIp(new Headers({ 'x-real-ip': '203.0.113.8' }))).toBe('203.0.113.8');
		expect(clientIp(new Headers())).toBeNull();
		expect(clientIp(new Headers({ 'x-forwarded-for': '::1' }))).toBeNull();
		expect(clientIp(new Headers({ 'x-forwarded-for': '127.0.0.1' }))).toBeNull();
		expect(clientIp(new Headers({ 'x-real-ip': '::ffff:127.0.0.1' }))).toBeNull();
	});

	it('never puts the raw value in the key', () => {
		const key = rateLimitKey('booking-phone:shop', '+15550100000');
		expect(key).toMatch(/^booking-phone:shop:[0-9a-f]{64}$/);
		expect(key).not.toContain('5550100000');
	});
});

describe('buildIcs', () => {
	it('writes a UTC event with escaped text and CRLF line endings', () => {
		const ics = buildIcs({
			uid: 'ABC@fullcut.ca',
			startsAt: '2026-03-10T14:00:00.000Z',
			endsAt: '2026-03-10T14:30:00.000Z',
			stamp: '2026-03-01T12:00:00.000Z',
			summary: 'Haircut, with Alex; Demo',
			location: '1 Main St\nToronto',
		});
		expect(ics).toContain('DTSTART:20260310T140000Z\r\n');
		expect(ics).toContain('DTEND:20260310T143000Z\r\n');
		expect(ics).toContain('SUMMARY:Haircut\\, with Alex\\; Demo\r\n');
		expect(ics).toContain('LOCATION:1 Main St\\nToronto\r\n');
		expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
	});

	it('folds long lines at 75 octets', () => {
		const ics = buildIcs({
			uid: 'x',
			startsAt: '2026-03-10T14:00:00Z',
			endsAt: '2026-03-10T14:30:00Z',
			stamp: '2026-03-01T12:00:00Z',
			summary: 'é'.repeat(80),
		});
		for (const line of ics.split('\r\n')) {
			expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
		}
		expect(ics).toContain('\r\n é');
	});

	it('escapes backslashes and formats UTC stamps', () => {
		expect(escapeText('a\\b')).toBe('a\\\\b');
		expect(icsUtc('2026-03-10T09:05:07-05:00')).toBe('20260310T140507Z');
	});
});
