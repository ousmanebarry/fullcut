import { describe, expect, it } from 'vitest';
import { minutesLabel, waitlistPreview } from '@/lib/waitlist/settings';
import { waitlistSettingsSchema } from '@/lib/shop/schemas';

describe('waitlistPreview', () => {
	it('describes the defaults in plain language', () => {
		expect(
			waitlistPreview({ enabled: true, waveSize: 3, offerMinutes: 15, minNoticeMinutes: 60 }),
		).toBe(
			'When a slot frees up at least 1 hour ahead, we text up to 3 matching clients; the first to tap gets it. If nobody books within 15 minutes, the next clients get a text.',
		);
	});

	it('says so when the waitlist is off', () => {
		expect(
			waitlistPreview({ enabled: false, waveSize: 3, offerMinutes: 15, minNoticeMinutes: 60 }),
		).toMatch(/off/);
	});

	it('handles a single client per wave', () => {
		expect(
			waitlistPreview({ enabled: true, waveSize: 1, offerMinutes: 15, minNoticeMinutes: 90 }),
		).toContain('we text 1 matching client;');
	});

	it.each([
		[15, '15 minutes'],
		[60, '1 hour'],
		[90, '90 minutes'],
		[180, '3 hours'],
	])('labels %i minutes as %s', (minutes, label) => {
		expect(minutesLabel(minutes)).toBe(label);
	});
});

describe('waitlistSettingsSchema', () => {
	const valid = { enabled: true, waveSize: '3', offerMinutes: '15', minNoticeMinutes: '60' };

	it('coerces form values', () => {
		expect(waitlistSettingsSchema.parse(valid)).toEqual({
			enabled: true,
			waveSize: 3,
			offerMinutes: 15,
			minNoticeMinutes: 60,
		});
	});

	it.each([
		['waveSize', '0'],
		['waveSize', '11'],
		['waveSize', '2.5'],
		['offerMinutes', '4'],
		['offerMinutes', '121'],
		['minNoticeMinutes', '14'],
		['minNoticeMinutes', '1441'],
	])('rejects %s = %s', (field, value) => {
		expect(waitlistSettingsSchema.safeParse({ ...valid, [field]: value }).success).toBe(false);
	});
});
