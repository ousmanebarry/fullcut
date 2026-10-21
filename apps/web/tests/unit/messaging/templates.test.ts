import { describe, expect, it } from 'vitest';
import { parseInboundKind } from '@/lib/messaging/keywords';
import { smsSegments } from '@/lib/messaging/segments';
import {
	MANAGE_LINK_PLACEHOLDER,
	needsManageLink,
	renderMessage,
	type TemplateInput,
} from '@/lib/messaging/templates';
import { MESSAGE_TYPES } from '@/lib/messaging/types';
import { instantFromIso, timeZone } from '@/lib/time';

const input: TemplateInput = {
	shopName: 'Demo Barbers',
	serviceName: 'Skin Fade',
	staffName: 'Sam',
	// Tue Nov 3, 10:00 AM in Toronto (EST, the week after DST ends).
	startsAt: instantFromIso('2026-11-03T15:00:00Z'),
	timezone: timeZone('America/Toronto'),
	manageUrl: `https://fullcut.app/b/${'x'.repeat(43)}`,
	signOff: null,
	// Mon Nov 2, 10:00 AM in Toronto.
	confirmationDueAt: instantFromIso('2026-11-02T15:00:00Z'),
};

describe('templates', () => {
	it('confirmation', () => {
		expect(renderMessage('confirmation', input)).toMatchInlineSnapshot(
			`"Demo Barbers: your Skin Fade with Sam is booked for Tue Nov 3 at 10:00 AM. Manage: https://fullcut.app/b/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"`,
		);
	});

	it('reminder', () => {
		expect(renderMessage('reminder', input)).toMatchInlineSnapshot(
			`"Demo Barbers: reminder - your Skin Fade with Sam is Tue Nov 3 at 10:00 AM. Need to change? https://fullcut.app/b/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"`,
		);
	});

	it('confirm request', () => {
		expect(renderMessage('confirm_request', input)).toMatchInlineSnapshot(
			`"Demo Barbers: reply YES to confirm your Skin Fade, Tue Nov 3 at 10:00 AM. To change: https://fullcut.app/b/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"`,
		);
	});

	it('rescheduled', () => {
		expect(renderMessage('rescheduled', input)).toMatchInlineSnapshot(
			`"Demo Barbers: your Skin Fade with Sam is now Tue Nov 3 at 10:00 AM. Manage: https://fullcut.app/b/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"`,
		);
	});

	it('cancelled', () => {
		expect(renderMessage('cancelled', input)).toMatchInlineSnapshot(
			`"Demo Barbers: your Skin Fade on Tue Nov 3 at 10:00 AM has been cancelled. Reply to this text with any questions."`,
		);
	});

	it('adds the sign-off on its own line', () => {
		expect(renderMessage('reminder', { ...input, signOff: '- Sam' })).toMatchInlineSnapshot(`
			"Demo Barbers: reminder - your Skin Fade with Sam is Tue Nov 3 at 10:00 AM. Need to change? https://fullcut.app/b/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
			- Sam"
		`);
	});

	it('stored copies carry a placeholder instead of the link', () => {
		const stored = renderMessage('confirmation', { ...input, manageUrl: MANAGE_LINK_PLACEHOLDER });
		expect(stored).toContain(MANAGE_LINK_PLACEHOLDER);
		expect(stored).not.toContain('https://');
	});

	it('cancellation notices carry no link', () => {
		expect(needsManageLink('cancelled')).toBe(false);
		expect(renderMessage('cancelled', input)).not.toContain('https://');
	});

	it('final warning names the deadline in shop time', () => {
		expect(needsManageLink('final_warning')).toBe(false);
		expect(renderMessage('final_warning', input)).toMatchInlineSnapshot(
			`"Demo Barbers: reply YES by Mon Nov 2 at 10:00 AM to keep your Skin Fade on Tue Nov 3 at 10:00 AM, or your spot may go to someone else."`,
		);
	});

	it('extra reminder', () => {
		expect(renderMessage('extra_reminder', input)).toMatchInlineSnapshot(
			`"Demo Barbers: see you soon - Skin Fade with Sam, Tue Nov 3 at 10:00 AM. Need to change? https://fullcut.app/b/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"`,
		);
	});

	it('release notice carries no link', () => {
		expect(needsManageLink('released')).toBe(false);
		expect(renderMessage('released', input)).toMatchInlineSnapshot(
			`"Demo Barbers: we didn't hear back, so we released your Skin Fade on Tue Nov 3 at 10:00 AM. Reply if you still want to come."`,
		);
	});

	it.each(MESSAGE_TYPES)('%s starts with the shop name and fits one GSM-7 segment', (type) => {
		const text = renderMessage(type, input);
		expect(text.startsWith('Demo Barbers: ')).toBe(true);
		expect(smsSegments(text)).toEqual({ encoding: 'GSM-7', segments: 1 });
	});

	it.each(MESSAGE_TYPES)('%s stays within two segments with long names and a sign-off', (type) => {
		const text = renderMessage(type, {
			...input,
			shopName: "The Gentlemen's Grooming Lounge",
			serviceName: 'Beard trim and hot towel shave',
			staffName: 'Alexandra',
			signOff: '- Alexandra at the Lounge, Queen St W',
		});
		expect(smsSegments(text).segments).toBeLessThanOrEqual(2);
	});
});

describe('smsSegments', () => {
	it('counts GSM-7 text in 160/153 character segments', () => {
		expect(smsSegments('a'.repeat(160))).toEqual({ encoding: 'GSM-7', segments: 1 });
		expect(smsSegments('a'.repeat(161))).toEqual({ encoding: 'GSM-7', segments: 2 });
		expect(smsSegments('a'.repeat(306))).toEqual({ encoding: 'GSM-7', segments: 2 });
	});

	it('counts extended characters twice', () => {
		expect(smsSegments('€'.repeat(80))).toEqual({ encoding: 'GSM-7', segments: 1 });
		expect(smsSegments('€'.repeat(81))).toEqual({ encoding: 'GSM-7', segments: 2 });
	});

	it('switches to UCS-2 for a curly quote or emoji', () => {
		expect(smsSegments('you’re booked')).toEqual({ encoding: 'UCS-2', segments: 1 });
		expect(smsSegments(`${'a'.repeat(70)}✂`)).toEqual({ encoding: 'UCS-2', segments: 2 });
	});
});

describe('parseInboundKind', () => {
	it.each([
		['STOP', 'opt_out'],
		['stop', 'opt_out'],
		[' Stop. ', 'opt_out'],
		['STOPALL', 'opt_out'],
		['unsubscribe', 'opt_out'],
		['Cancel', 'opt_out'],
		['END', 'opt_out'],
		['quit', 'opt_out'],
		['START', 'opt_in'],
		['unstop', 'opt_in'],
		['YES', 'confirm'],
		['yes!', 'confirm'],
		['Y', 'confirm'],
		['y', 'confirm'],
		['yes but can I come at 3?', 'other'],
		['Please stop by at 3', 'other'],
		['', 'other'],
		['Running 10 min late', 'other'],
	])('%j → %s', (body, kind) => {
		expect(parseInboundKind(body)).toBe(kind);
	});
});
