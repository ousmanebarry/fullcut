import { z } from 'zod';
import { countryForCurrency, normalizePhone } from '@/lib/contact/phone';
import { dollarsToCentsSchema } from '@/lib/money';
import { timeZone } from '@/lib/time';
import { hoursToRules, weeklyHoursSchema } from './hours';
import { slugSchema } from './slug';

export const CURRENCIES = ['CAD', 'USD'] as const;
export const SLOT_STEPS = [5, 10, 15, 20, 30, 60] as const;

const HH_MM = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

const optionalText = (max: number) =>
	z
		.string()
		.trim()
		.max(max, { error: `Use ${max} characters or fewer.` })
		.transform((value) => value || null);

/** Whole minutes from a text input, e.g. "30". */
const minutesSchema = (min: number, max: number, label: string) =>
	z
		.string()
		.trim()
		.regex(/^\d+$/, { error: `Enter ${label} in whole minutes.` })
		.transform(Number)
		.pipe(
			z
				.number()
				.min(min, {
					error: `${label[0]?.toUpperCase()}${label.slice(1)} must be at least ${min} min.`,
				})
				.max(max, {
					error: `${label[0]?.toUpperCase()}${label.slice(1)} must be at most ${max} min.`,
				}),
		);

export const shopNameSchema = z
	.string()
	.trim()
	.min(1, { error: 'Enter your shop name.' })
	.max(80, { error: 'Use 80 characters or fewer.' });

export const timezoneSchema = z.string().refine(
	(value) => {
		try {
			timeZone(value);
			return true;
		} catch {
			return false;
		}
	},
	{ error: 'Choose a timezone from the list.' },
);

export const currencySchema = z.enum(CURRENCIES, { error: 'Choose CAD or USD.' });

export const staffNameSchema = z
	.string()
	.trim()
	.min(1, { error: 'Enter a name.' })
	.max(60, { error: 'Use 60 characters or fewer.' });

export const serviceSchema = z.object({
	name: z
		.string()
		.trim()
		.min(1, { error: 'Enter a service name.' })
		.max(80, { error: 'Use 80 characters or fewer.' }),
	durationMinutes: minutesSchema(5, 480, 'duration'),
	bufferMinutes: minutesSchema(0, 120, 'buffer'),
	price: dollarsToCentsSchema,
});
export type ServiceInput = z.output<typeof serviceSchema>;

export const onboardingSchema = z.object({
	shop: z.object({
		name: shopNameSchema,
		slug: slugSchema,
		timezone: timezoneSchema,
		currency: currencySchema,
	}),
	staff: z.object({ displayName: staffNameSchema }),
	services: z
		.array(serviceSchema)
		.min(1, { error: 'Add at least one service.' })
		.max(3, { error: 'Add up to 3 services now; you can add more later.' }),
	hours: weeklyHoursSchema,
});
export type OnboardingInput = z.input<typeof onboardingSchema>;

/** The jsonb payload `public.onboard_shop` expects. */
export function toOnboardPayload(input: z.output<typeof onboardingSchema>) {
	return {
		shop: input.shop,
		staff: { display_name: input.staff.displayName },
		services: input.services.map((s) => ({
			name: s.name,
			duration_minutes: s.durationMinutes,
			buffer_minutes: s.bufferMinutes,
			price_cents: s.price,
		})),
		rules: hoursToRules(input.hours),
	};
}

export const shopProfileSchema = z
	.object({
		name: shopNameSchema,
		slug: slugSchema,
		timezone: timezoneSchema,
		currency: currencySchema,
		phone: z.string().trim().max(30),
		address: optionalText(300),
		aboutText: optionalText(2000),
		logoUrl: z
			.string()
			.trim()
			.max(2048)
			.refine((value) => value === '' || /^https:\/\/[^\s]+$/.test(value), {
				error: 'Use a full https:// link.',
			})
			.transform((value) => value || null),
	})
	.transform((input, ctx) => {
		if (input.phone === '') return { ...input, phone: null };
		const phone = normalizePhone(input.phone, countryForCurrency(input.currency));
		if (!phone) {
			ctx.addIssue({ code: 'custom', path: ['phone'], message: 'Enter a valid phone number.' });
			return z.NEVER;
		}
		return { ...input, phone };
	});

export const bookingRulesSchema = z.object({
	slotStepMinutes: z.coerce
		.number()
		.refine((value) => (SLOT_STEPS as readonly number[]).includes(value), {
			error: 'Choose a slot step.',
		}),
	minLeadMinutes: z.coerce
		.number({ error: 'Choose a lead time.' })
		.int()
		.min(0)
		.max(10080, { error: 'Lead time can be at most 7 days.' }),
	maxHorizonDays: z.coerce
		.number({ error: 'Enter a number of days.' })
		.int({ error: 'Enter whole days.' })
		.min(1, { error: 'Allow booking at least 1 day ahead.' })
		.max(365, { error: 'Allow booking at most 365 days ahead.' }),
	cancelCutoffHours: z.coerce
		.number({ error: 'Enter a number of hours.' })
		.int({ error: 'Enter whole hours.' })
		.min(0, { error: 'Use 0 or more hours.' })
		.max(168, { error: 'Use at most 168 hours (7 days).' }),
	maxActiveBookingsPerPhone: z.coerce
		.number({ error: 'Enter a number of bookings.' })
		.int({ error: 'Enter a whole number.' })
		.min(1, { error: 'Allow at least 1 booking.' })
		.max(20, { error: 'Allow at most 20 bookings.' }),
	bookingPageEnabled: z.boolean(),
});

export const staffFormSchema = z.object({ displayName: staffNameSchema });

export const timeOffFormSchema = z
	.object({
		staffId: z.uuid({ error: 'Choose a staff member.' }),
		startDate: z.iso.date({ error: 'Choose a start date.' }),
		endDate: z.iso.date({ error: 'Choose an end date.' }),
		allDay: z.boolean(),
		startTime: z.string().optional(),
		endTime: z.string().optional(),
		reason: optionalText(200),
	})
	.superRefine((input, ctx) => {
		if (input.allDay) return;
		if (!input.startTime || !HH_MM.test(input.startTime)) {
			ctx.addIssue({ code: 'custom', path: ['startTime'], message: 'Choose a start time.' });
		}
		if (!input.endTime || !HH_MM.test(input.endTime)) {
			ctx.addIssue({ code: 'custom', path: ['endTime'], message: 'Choose an end time.' });
		}
	});
