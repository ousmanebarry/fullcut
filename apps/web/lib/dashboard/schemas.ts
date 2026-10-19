import { z } from 'zod';
import { localDate, type LocalDate } from '@/lib/time';

// Lenient UUID shape: seeded ids are not RFC 4122 variants.
export const idSchema = z.guid({ error: 'Choose an option.' });

export const localDateSchema = z
	.string()
	.refine(
		(value) => {
			try {
				localDate(value);
				return true;
			} catch {
				return false;
			}
		},
		{ error: 'Choose a date.' },
	)
	.transform((value) => value as LocalDate);

export const localTimeSchema = z
	.string()
	.regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, { error: 'Choose a time.' });

const optionalText = (max: number, error: string) =>
	z
		.string()
		.trim()
		.max(max, { error })
		.optional()
		.transform((value) => value || undefined);

export const outcomeSchema = z.enum(['completed', 'no_show']);

export const cancelSchema = z.object({
	bookingId: idSchema,
	reason: optionalText(200, 'Keep the reason under 200 characters.'),
});

export const bulkOutcomeSchema = z.object({
	bookingIds: z.array(idSchema).min(1).max(200),
	outcome: outcomeSchema,
});

const whenSchema = {
	serviceId: idSchema,
	staffId: idSchema,
	date: localDateSchema,
	time: localTimeSchema,
	overrideHours: z.boolean().default(false),
};

export const editBookingSchema = z.object({ bookingId: idSchema, ...whenSchema });
export type EditBookingInput = z.output<typeof editBookingSchema>;

export const manualBookingSchema = z
	.object({
		source: z.enum(['phone', 'walk_in'], { error: 'Choose phone or walk-in.' }),
		clientId: idSchema.optional(),
		clientName: optionalText(80, 'Use a shorter name.'),
		phone: optionalText(30, 'Enter a valid phone number.'),
		notes: optionalText(500, 'Keep notes under 500 characters.'),
		...whenSchema,
	})
	.superRefine((input, ctx) => {
		if (input.clientId) return;
		if (!input.clientName) {
			ctx.addIssue({ code: 'custom', path: ['clientName'], message: "Enter the client's name." });
		}
		if (input.source === 'phone' && !input.phone) {
			ctx.addIssue({
				code: 'custom',
				path: ['phone'],
				message: 'Phone bookings need a phone number.',
			});
		}
	});
export type ManualBookingInput = z.output<typeof manualBookingSchema>;

export const freeSlotsSchema = z.object({
	serviceId: idSchema,
	staffId: idSchema,
	date: localDateSchema,
	excludeBookingId: idSchema.optional(),
});

export const clientSearchSchema = z.string().trim().min(2).max(60);

export const calendarParamsSchema = z.object({
	view: z.enum(['day', 'week']).catch('day'),
	date: localDateSchema.optional().catch(undefined),
	staff: idSchema.optional().catch(undefined),
	booking: idSchema.optional().catch(undefined),
	new: z.literal('1').optional().catch(undefined),
	time: localTimeSchema.optional().catch(undefined),
});
export type CalendarParams = z.output<typeof calendarParamsSchema>;
