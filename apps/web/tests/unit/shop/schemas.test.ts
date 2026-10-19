import { describe, expect, it } from 'vitest';
import { fieldErrorsFrom } from '@/lib/forms';
import { defaultWeeklyHours } from '@/lib/shop/hours';
import {
	bookingRulesSchema,
	onboardingSchema,
	serviceSchema,
	shopProfileSchema,
	timeOffFormSchema,
	toOnboardPayload,
	type OnboardingInput,
} from '@/lib/shop/schemas';

const validOnboarding: OnboardingInput = {
	shop: { name: 'Fade Lab', slug: 'fade-lab', timezone: 'America/Toronto', currency: 'CAD' },
	staff: { displayName: 'Sam Owner' },
	services: [
		{ name: 'Haircut', durationMinutes: '30', bufferMinutes: '5', price: '35' },
		{ name: 'Beard trim', durationMinutes: '20', bufferMinutes: '0', price: '20.50' },
	],
	hours: defaultWeeklyHours(),
};

describe('onboardingSchema', () => {
	it('builds the onboard_shop payload with cents and rules', () => {
		const payload = toOnboardPayload(onboardingSchema.parse(validOnboarding));
		expect(payload.shop).toEqual({
			name: 'Fade Lab',
			slug: 'fade-lab',
			timezone: 'America/Toronto',
			currency: 'CAD',
		});
		expect(payload.staff).toEqual({ display_name: 'Sam Owner' });
		expect(payload.services).toEqual([
			{ name: 'Haircut', duration_minutes: 30, buffer_minutes: 5, price_cents: 3500 },
			{ name: 'Beard trim', duration_minutes: 20, buffer_minutes: 0, price_cents: 2050 },
		]);
		expect(payload.rules).toHaveLength(5);
	});

	it('reports nested field paths for the wizard', () => {
		const result = onboardingSchema.safeParse({
			...validOnboarding,
			shop: { ...validOnboarding.shop, slug: 'dashboard', timezone: 'Mars/Olympus' },
			services: [{ name: '', durationMinutes: '0', bufferMinutes: '-1', price: 'free' }],
		});
		expect(result.success).toBe(false);
		const errors = fieldErrorsFrom(result.error!);
		expect(Object.keys(errors).sort()).toEqual([
			'services.0.bufferMinutes',
			'services.0.durationMinutes',
			'services.0.name',
			'services.0.price',
			'shop.slug',
			'shop.timezone',
		]);
	});

	it('requires 1–3 services', () => {
		expect(onboardingSchema.safeParse({ ...validOnboarding, services: [] }).success).toBe(false);
		const four = Array.from({ length: 4 }, () => validOnboarding.services[0]!);
		expect(onboardingSchema.safeParse({ ...validOnboarding, services: four }).success).toBe(false);
	});
});

describe('serviceSchema', () => {
	it('enforces duration and buffer ranges', () => {
		expect(
			serviceSchema.safeParse({ name: 'X', durationMinutes: '4', bufferMinutes: '0', price: '1' })
				.success,
		).toBe(false);
		expect(
			serviceSchema.safeParse({ name: 'X', durationMinutes: '481', bufferMinutes: '0', price: '1' })
				.success,
		).toBe(false);
		expect(
			serviceSchema.safeParse({
				name: 'X',
				durationMinutes: '30',
				bufferMinutes: '121',
				price: '1',
			}).success,
		).toBe(false);
		expect(
			serviceSchema.safeParse({
				name: 'X',
				durationMinutes: '30.5',
				bufferMinutes: '0',
				price: '1',
			}).success,
		).toBe(false);
	});
});

describe('shopProfileSchema', () => {
	const base = {
		name: 'Fade Lab',
		slug: 'fade-lab',
		timezone: 'America/Vancouver',
		currency: 'CAD',
		phone: '',
		address: '',
		aboutText: '',
		logoUrl: '',
	};

	it('turns empty optional fields into null', () => {
		expect(shopProfileSchema.parse(base)).toMatchObject({
			phone: null,
			address: null,
			aboutText: null,
			logoUrl: null,
		});
	});

	it('normalises the phone to E.164 using the shop country', () => {
		expect(shopProfileSchema.parse({ ...base, phone: '(416) 555-0199' }).phone).toBe(
			'+14165550199',
		);
		expect(shopProfileSchema.safeParse({ ...base, phone: '12345' }).success).toBe(false);
	});

	it('only accepts https logo links', () => {
		expect(
			shopProfileSchema.safeParse({ ...base, logoUrl: 'http://example.com/a.png' }).success,
		).toBe(false);
		expect(shopProfileSchema.safeParse({ ...base, logoUrl: 'javascript:alert(1)' }).success).toBe(
			false,
		);
		expect(shopProfileSchema.parse({ ...base, logoUrl: 'https://example.com/a.png' }).logoUrl).toBe(
			'https://example.com/a.png',
		);
	});
});

describe('bookingRulesSchema', () => {
	const valid = {
		slotStepMinutes: '15',
		minLeadMinutes: '120',
		maxHorizonDays: '60',
		cancelCutoffHours: '2',
		maxActiveBookingsPerPhone: '3',
		bookingPageEnabled: true,
	};

	it('coerces form strings and checks ranges', () => {
		expect(bookingRulesSchema.parse(valid)).toEqual({
			slotStepMinutes: 15,
			minLeadMinutes: 120,
			maxHorizonDays: 60,
			cancelCutoffHours: 2,
			maxActiveBookingsPerPhone: 3,
			bookingPageEnabled: true,
		});
		expect(bookingRulesSchema.safeParse({ ...valid, slotStepMinutes: '7' }).success).toBe(false);
		expect(bookingRulesSchema.safeParse({ ...valid, maxHorizonDays: '366' }).success).toBe(false);
	});

	it('bounds the cancel cutoff and per-phone cap', () => {
		expect(bookingRulesSchema.safeParse({ ...valid, cancelCutoffHours: '0' }).success).toBe(true);
		expect(bookingRulesSchema.safeParse({ ...valid, cancelCutoffHours: '169' }).success).toBe(
			false,
		);
		expect(bookingRulesSchema.safeParse({ ...valid, cancelCutoffHours: '1.5' }).success).toBe(
			false,
		);
		expect(bookingRulesSchema.safeParse({ ...valid, maxActiveBookingsPerPhone: '0' }).success).toBe(
			false,
		);
		expect(
			bookingRulesSchema.safeParse({ ...valid, maxActiveBookingsPerPhone: '21' }).success,
		).toBe(false);
	});
});

describe('timeOffFormSchema', () => {
	const base = {
		staffId: '3f1c2a8e-4b6d-4e2f-9a1b-2c3d4e5f6a7b',
		startDate: '2026-07-14',
		endDate: '2026-07-14',
		reason: '',
	};

	it('needs times unless the range is all day', () => {
		expect(timeOffFormSchema.safeParse({ ...base, allDay: true }).success).toBe(true);
		const result = timeOffFormSchema.safeParse({
			...base,
			allDay: false,
			startTime: '',
			endTime: '25:00',
		});
		expect(result.success).toBe(false);
		expect(Object.keys(fieldErrorsFrom(result.error!)).sort()).toEqual(['endTime', 'startTime']);
	});
});
