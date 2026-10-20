import { z } from 'zod';
import { daysBetween, instantFromIso, localDate, type Instant, type LocalDate } from '@/lib/time';

export const MAX_RANGE_DAYS = 7;
export const MAX_NAME_LENGTH = 80;
export const MAX_NOTES_LENGTH = 500;

// Lenient UUID shape: stable fixture ids are not RFC 4122 variants.
const idSchema = z.guid({ error: 'Choose an option.' });

export const staffChoiceSchema = z.union([z.literal('any'), idSchema]);
export type StaffChoice = z.infer<typeof staffChoiceSchema>;

const localDateSchema = z
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
		{ error: 'Use a YYYY-MM-DD date.' },
	)
	.transform((value) => value as LocalDate);

const instantSchema = z
	.string()
	.pipe(z.iso.datetime({ offset: true, error: 'Choose a time.' }))
	.transform((value): Instant => instantFromIso(value));

export const availabilityQuerySchema = z
	.object({
		serviceId: idSchema,
		staffId: staffChoiceSchema.default('any'),
		from: localDateSchema,
		to: localDateSchema,
	})
	.refine((q) => daysBetween(q.from, q.to) >= 0, {
		path: ['to'],
		error: '`to` must not be before `from`.',
	})
	.refine((q) => daysBetween(q.from, q.to) < MAX_RANGE_DAYS, {
		path: ['to'],
		error: `Request at most ${MAX_RANGE_DAYS} days.`,
	});
export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;

const optionalText = (max: number, error: string) =>
	z
		.string()
		.trim()
		.max(max, { error })
		.optional()
		.transform((value) => value || undefined);

export const bookingBodySchema = z.object({
	serviceId: idSchema,
	staffId: staffChoiceSchema,
	startsAt: instantSchema,
	name: z
		.string({ error: 'Enter your name.' })
		.trim()
		.min(1, { error: 'Enter your name.' })
		.max(MAX_NAME_LENGTH, { error: 'Use a shorter name.' }),
	phone: z
		.string({ error: 'Enter your mobile number.' })
		.trim()
		.min(1, { error: 'Enter your mobile number.' })
		.max(30, { error: 'Enter a valid phone number.' }),
	email: z
		.string()
		.trim()
		.toLowerCase()
		.optional()
		.transform((value) => value || undefined)
		.pipe(z.email({ error: 'Enter a valid email or leave it blank.' }).optional()),
	notes: optionalText(MAX_NOTES_LENGTH, `Keep notes under ${MAX_NOTES_LENGTH} characters.`),
	marketingOptIn: z.boolean().default(false),
	/** The deposit shown to the client; the booking is refused if the real one differs. */
	expectedDepositCents: z.number().int().min(0).max(100_000).default(0),
	/** Honeypot: hidden from people, filled by naive bots. */
	website: z.string().max(200).optional(),
});
export type BookingBody = z.infer<typeof bookingBodySchema>;

export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const tokenSchema = z.string().regex(TOKEN_PATTERN, { error: 'This link is not valid.' });

export const cancelBodySchema = z.object({ token: tokenSchema });

export const rescheduleBodySchema = z.object({
	token: tokenSchema,
	staffId: staffChoiceSchema,
	startsAt: instantSchema,
});

const SOURCE_PATTERN = /^[a-z0-9_:-]{1,40}$/;

/** Booking source from a `?src=` link parameter; anything unexpected counts as `direct`. */
export function sourceFromParam(value: string | null | undefined): string {
	const source = value?.trim().toLowerCase() ?? '';
	return SOURCE_PATTERN.test(source) ? source : 'direct';
}
