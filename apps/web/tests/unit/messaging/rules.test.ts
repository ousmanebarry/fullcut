import { describe, expect, it } from 'vitest';
import { decideSend, quietHoursEnd, type SendContext } from '@/lib/messaging/rules';
import { MESSAGE_TYPES, type MessageType } from '@/lib/messaging/types';
import { instantFromIso, timeZone, type Instant } from '@/lib/time';

const toronto = timeZone('America/Toronto');
const at = (iso: string) => instantFromIso(iso);

const allEnabled = Object.fromEntries(MESSAGE_TYPES.map((t) => [t, true])) as Record<
	MessageType,
	boolean
>;

function ctx(overrides: {
	type?: MessageType;
	enabled?: Partial<Record<MessageType, boolean>>;
	isDemo?: boolean;
	phone?: string | null;
	optedOut?: boolean;
	status?: SendContext['booking']['status'];
	startsAt?: Instant;
}): SendContext {
	const type = overrides.type ?? 'reminder';
	return {
		type,
		shop: {
			timezone: toronto,
			isDemo: overrides.isDemo ?? false,
			enabled: { ...allEnabled, ...overrides.enabled },
		},
		client: {
			phoneE164: overrides.phone === undefined ? '+14165550123' : overrides.phone,
			smsOptedOut: overrides.optedOut ?? false,
		},
		booking: {
			status: overrides.status ?? (type === 'cancelled' ? 'cancelled' : 'confirmed'),
			startsAt: overrides.startsAt ?? at('2026-10-22T15:00:00Z'),
		},
	};
}

// 12:00 in Toronto (EDT, UTC-4).
const noon = at('2026-10-20T16:00:00Z');

describe('decideSend skip reasons', () => {
	it('sends when everything checks out', () => {
		expect(decideSend(ctx({}), noon)).toEqual({ action: 'send' });
	});

	it.each([
		['demo_shop', { isDemo: true }],
		['type_disabled', { enabled: { reminder: false } }],
		['opted_out', { optedOut: true }],
		['no_phone', { phone: null }],
		['invalid_phone', { phone: '+15555550123' }],
		['booking_inactive', { status: 'cancelled' as const }],
		['booking_inactive', { status: 'completed' as const }],
		['too_late', { startsAt: noon }],
	])('skips with %s', (reason, overrides) => {
		expect(decideSend(ctx(overrides), noon)).toEqual({ action: 'skip', reason });
	});

	it('only turns off the type that was disabled', () => {
		expect(decideSend(ctx({ type: 'confirmation', enabled: { reminder: false } }), noon)).toEqual({
			action: 'send',
		});
	});

	it('requires a cancelled booking for a cancellation notice', () => {
		expect(decideSend(ctx({ type: 'cancelled' }), noon)).toEqual({ action: 'send' });
		expect(decideSend(ctx({ type: 'cancelled', status: 'confirmed' }), noon)).toEqual({
			action: 'skip',
			reason: 'booking_inactive',
		});
	});

	it('demo shop wins over every other reason', () => {
		expect(decideSend(ctx({ isDemo: true, optedOut: true, phone: null }), noon)).toEqual({
			action: 'skip',
			reason: 'demo_shop',
		});
	});
});

describe('quiet hours (21:00–09:00 shop time)', () => {
	it.each([
		['08:59 EDT', '2026-10-20T12:59:00Z', '2026-10-20T13:00:00Z'],
		['21:00 EDT', '2026-10-21T01:00:00Z', '2026-10-21T13:00:00Z'],
		['23:30 EDT', '2026-10-21T03:30:00Z', '2026-10-21T13:00:00Z'],
		['00:00 EDT', '2026-10-21T04:00:00Z', '2026-10-21T13:00:00Z'],
		['03:00 EDT', '2026-10-21T07:00:00Z', '2026-10-21T13:00:00Z'],
	])('defers a reminder at %s to 09:00', (_label, now, until) => {
		expect(quietHoursEnd(at(now), toronto)).toBe(at(until));
		expect(decideSend(ctx({}), at(now))).toEqual({ action: 'defer', until: at(until) });
	});

	it.each([
		['09:00 EDT', '2026-10-20T13:00:00Z'],
		['20:59 EDT', '2026-10-21T00:59:00Z'],
	])('sends at %s', (_label, now) => {
		expect(quietHoursEnd(at(now), toronto)).toBeNull();
		expect(decideSend(ctx({}), at(now))).toEqual({ action: 'send' });
	});

	it('spring forward: 23:00 EST on Mar 7 waits until 09:00 EDT on Mar 8', () => {
		expect(quietHoursEnd(at('2026-03-08T04:00:00Z'), toronto)).toBe(at('2026-03-08T13:00:00Z'));
	});

	it('spring forward: 02:30 does not exist; 03:30 EDT waits until 09:00 EDT', () => {
		expect(quietHoursEnd(at('2026-03-08T07:30:00Z'), toronto)).toBe(at('2026-03-08T13:00:00Z'));
	});

	it('fall back: 22:00 EDT on Oct 31 waits until 09:00 EST on Nov 1', () => {
		expect(quietHoursEnd(at('2026-11-01T02:00:00Z'), toronto)).toBe(at('2026-11-01T14:00:00Z'));
	});

	it('fall back: both 01:30s wait until 09:00 EST', () => {
		expect(quietHoursEnd(at('2026-11-01T05:30:00Z'), toronto)).toBe(at('2026-11-01T14:00:00Z'));
		expect(quietHoursEnd(at('2026-11-01T06:30:00Z'), toronto)).toBe(at('2026-11-01T14:00:00Z'));
	});

	it('confirmations go out immediately, even at night', () => {
		expect(decideSend(ctx({ type: 'confirmation' }), at('2026-10-21T03:30:00Z'))).toEqual({
			action: 'send',
		});
	});

	it('cancellation notices wait for the morning', () => {
		expect(decideSend(ctx({ type: 'cancelled' }), at('2026-10-21T03:30:00Z'))).toEqual({
			action: 'defer',
			until: at('2026-10-21T13:00:00Z'),
		});
	});

	it('skips when 09:00 is already past the appointment start', () => {
		// 08:30 appointment, reminder due at 23:00 the night before.
		const startsAt = at('2026-10-21T12:30:00Z');
		expect(decideSend(ctx({ startsAt }), at('2026-10-21T03:00:00Z'))).toEqual({
			action: 'skip',
			reason: 'too_late',
		});
	});

	it('defers when 09:00 is still before the appointment', () => {
		const startsAt = at('2026-10-21T13:30:00Z');
		expect(decideSend(ctx({ startsAt }), at('2026-10-21T03:00:00Z'))).toEqual({
			action: 'defer',
			until: at('2026-10-21T13:00:00Z'),
		});
	});
});
