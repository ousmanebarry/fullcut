import { describe, expect, it } from 'vitest';
import { decideWaitlistSend, type WaitlistSendContext } from '@/lib/messaging/rules';
import { smsSegments } from '@/lib/messaging/segments';
import {
	CLAIM_LINK_PLACEHOLDER,
	WAITLIST_LINK_PLACEHOLDER,
	renderWaitlistJoined,
	renderWaitlistOffer,
} from '@/lib/messaging/templates';
import { isMessageType, isWaitlistMessageType } from '@/lib/messaging/types';
import { instantFromIso, timeZone } from '@/lib/time';

const toronto = timeZone('America/Toronto');
// 12:00 and 22:00 in Toronto (EDT, UTC-4).
const noon = instantFromIso('2026-10-20T16:00:00Z');
const night = instantFromIso('2026-10-21T02:00:00Z');

function ctx(overrides: {
	type?: WaitlistSendContext['type'];
	isDemo?: boolean;
	waitlistEnabled?: boolean;
	phone?: string | null;
	optedOut?: boolean;
	active?: boolean;
	open?: boolean;
}): WaitlistSendContext {
	return {
		type: overrides.type ?? 'waitlist_joined',
		shop: {
			timezone: toronto,
			isDemo: overrides.isDemo ?? false,
			waitlistEnabled: overrides.waitlistEnabled ?? true,
		},
		client: {
			phoneE164: overrides.phone === undefined ? '+14165550123' : overrides.phone,
			smsOptedOut: overrides.optedOut ?? false,
		},
		entry: { active: overrides.active ?? true },
		offer: { open: overrides.open ?? true },
	};
}

describe('decideWaitlistSend', () => {
	it('sends when everything checks out', () => {
		expect(decideWaitlistSend(ctx({}), noon)).toEqual({ action: 'send' });
		expect(decideWaitlistSend(ctx({ type: 'waitlist_offer' }), noon)).toEqual({ action: 'send' });
	});

	it.each([
		['demo_shop', { isDemo: true }],
		['type_disabled', { waitlistEnabled: false }],
		['opted_out', { optedOut: true }],
		['no_phone', { phone: null }],
		['invalid_phone', { phone: '+15555550123' }],
		['entry_inactive', { active: false }],
	])('skips with %s', (reason, overrides) => {
		expect(decideWaitlistSend(ctx(overrides), noon)).toEqual({ action: 'skip', reason });
		expect(decideWaitlistSend(ctx({ ...overrides, type: 'waitlist_offer' }), noon)).toEqual({
			action: 'skip',
			reason,
		});
	});

	it('checks the demo shop before anything else', () => {
		expect(decideWaitlistSend(ctx({ isDemo: true, optedOut: true, active: false }), noon)).toEqual({
			action: 'skip',
			reason: 'demo_shop',
		});
	});

	it('never sends a closed offer', () => {
		expect(decideWaitlistSend(ctx({ type: 'waitlist_offer', open: false }), noon)).toEqual({
			action: 'skip',
			reason: 'offer_closed',
		});
	});

	it('never sends or defers an offer in quiet hours', () => {
		expect(decideWaitlistSend(ctx({ type: 'waitlist_offer' }), night)).toEqual({
			action: 'skip',
			reason: 'quiet_hours',
		});
	});

	it('sends the join confirmation in quiet hours because the client just acted', () => {
		expect(decideWaitlistSend(ctx({}), night)).toEqual({ action: 'send' });
	});
});

describe('renderWaitlistOffer', () => {
	const input = {
		shopName: 'Demo Barbers',
		serviceName: 'Skin Fade',
		staffName: 'Sam',
		// Tue Nov 3, 3:00 PM in Toronto; offer open until 2:15 PM.
		startsAt: instantFromIso('2026-11-03T20:00:00Z'),
		expiresAt: instantFromIso('2026-11-03T19:15:00Z'),
		timezone: toronto,
		claimUrl: `https://fullcut.app/w/${'x'.repeat(43)}`,
		signOff: null,
	};

	it('names the shop, service, staff, time and deadline', () => {
		expect(renderWaitlistOffer(input)).toMatchInlineSnapshot(
			`"Demo Barbers: a spot opened for Skin Fade with Sam, Tue Nov 3 at 3:00 PM. First to tap gets it: https://fullcut.app/w/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx (until 2:15 PM)"`,
		);
	});

	it('stays within two GSM-7 segments, even with a sign-off', () => {
		expect(smsSegments(renderWaitlistOffer(input))).toMatchObject({ encoding: 'GSM-7' });
		expect(smsSegments(renderWaitlistOffer(input)).segments).toBeLessThanOrEqual(2);
		expect(
			smsSegments(renderWaitlistOffer({ ...input, signOff: '- Sam' })).segments,
		).toBeLessThanOrEqual(2);
	});

	it('stored copies carry a placeholder instead of the link', () => {
		const stored = renderWaitlistOffer({ ...input, claimUrl: CLAIM_LINK_PLACEHOLDER });
		expect(stored).toContain(CLAIM_LINK_PLACEHOLDER);
		expect(stored).not.toContain('https://');
	});
});

describe('renderWaitlistJoined', () => {
	const input = {
		shopName: 'Demo Barbers',
		serviceName: 'Skin Fade',
		waitlistUrl: `https://fullcut.app/wl/${'x'.repeat(43)}`,
		signOff: null,
	};

	it('names the shop and service and carries the link', () => {
		expect(renderWaitlistJoined(input)).toMatchInlineSnapshot(
			`"Demo Barbers: you're on the waitlist for Skin Fade. We'll text if a spot opens - first to tap gets it. View or leave: https://fullcut.app/wl/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"`,
		);
	});

	it('stored copies carry a placeholder instead of the link', () => {
		const stored = renderWaitlistJoined({ ...input, waitlistUrl: WAITLIST_LINK_PLACEHOLDER });
		expect(stored).toContain(WAITLIST_LINK_PLACEHOLDER);
		expect(stored).not.toContain('https://');
	});

	it('stays within two segments with a sign-off', () => {
		const text = renderWaitlistJoined({ ...input, signOff: '- Sam' });
		expect(text.endsWith('\n- Sam')).toBe(true);
		expect(smsSegments(text).segments).toBeLessThanOrEqual(2);
	});
});

describe('waitlist message types', () => {
	it('are kept apart from booking message types', () => {
		expect(isWaitlistMessageType('waitlist_joined')).toBe(true);
		expect(isWaitlistMessageType('reminder')).toBe(false);
		expect(isMessageType('waitlist_joined')).toBe(false);
	});
});
