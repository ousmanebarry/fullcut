import { z } from 'zod';
import { daysBetween } from '@/lib/time';
import {
	idSchema,
	localDateSchema,
	MAX_NAME_LENGTH,
	staffChoiceSchema,
	tokenSchema,
} from '@/lib/public-booking/schemas';
import { MAX_TIME_WINDOWS } from './types';

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { error: 'Use HH:MM.' });

export const timeWindowSchema = z
	.object({
		weekday: z.number().int().min(0).max(6),
		start: clock,
		end: clock,
	})
	.refine((w) => w.start < w.end, { path: ['end'], error: 'End must be after start.' });

export const waitlistBodySchema = z
	.object({
		serviceId: idSchema,
		staffId: staffChoiceSchema,
		earliestDate: localDateSchema,
		latestDate: localDateSchema,
		timeWindows: z.array(timeWindowSchema).max(MAX_TIME_WINDOWS).default([]),
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
		/** Must be ticked: the recorded request to be texted when a spot opens. */
		offersRequested: z.literal(true, { error: 'Tick the box to join the waitlist.' }),
		/** Honeypot: hidden from people, filled by naive bots. */
		website: z.string().max(200).optional(),
	})
	.refine((b) => daysBetween(b.earliestDate, b.latestDate) >= 0, {
		path: ['latestDate'],
		error: 'The last date must not be before the first date.',
	});
export type WaitlistBody = z.infer<typeof waitlistBodySchema>;

export const leaveBodySchema = z.object({ token: tokenSchema });
