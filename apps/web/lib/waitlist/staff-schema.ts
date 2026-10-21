import { z } from 'zod';
import {
	idSchema,
	localDateSchema,
	MAX_NAME_LENGTH,
	staffChoiceSchema,
} from '@/lib/public-booking/schemas';
import { daysBetween } from '@/lib/time';
import { TIME_OF_DAY_PRESETS } from './types';

const presetIds = TIME_OF_DAY_PRESETS.map((p) => p.id) as [string, ...string[]];

/** Staff adding a client who asked by phone or in person. */
export const staffEntrySchema = z
	.object({
		name: z
			.string()
			.trim()
			.min(1, { error: "Enter the client's name." })
			.max(MAX_NAME_LENGTH, { error: 'Use a shorter name.' }),
		phone: z.string().trim().min(1, { error: 'Enter a mobile number.' }).max(30),
		serviceId: idSchema,
		staffId: staffChoiceSchema,
		earliestDate: localDateSchema,
		latestDate: localDateSchema,
		weekdays: z.array(z.coerce.number().int().min(0).max(6)).max(7),
		times: z.array(z.enum(presetIds)).max(presetIds.length),
		offersRequested: z.literal(true, {
			error: 'Only add clients who asked to be texted when a spot opens.',
		}),
	})
	.refine((b) => daysBetween(b.earliestDate, b.latestDate) >= 0, {
		path: ['latestDate'],
		error: 'The last date must not be before the first date.',
	});
export type StaffEntryInput = z.output<typeof staffEntrySchema>;
