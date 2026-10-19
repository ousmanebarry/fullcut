import { z } from 'zod';
import { idSchema } from '@/lib/dashboard/schemas';
import { CLIENT_SORTS } from './types';

export const MAX_CLIENT_NAME_LENGTH = 80;
export const MAX_NOTE_LENGTH = 1000;

// Bad or missing params fall back to defaults instead of erroring: they come from the URL.
export const clientListParamsSchema = z.object({
	q: z.string().trim().max(60).catch(''),
	sort: z.enum(CLIENT_SORTS).catch('name'),
	page: z.coerce.number().int().min(1).max(100_000).catch(1),
});
export type ClientListParams = z.output<typeof clientListParamsSchema>;

const contactFields = {
	name: z
		.string({ error: 'Enter a name.' })
		.trim()
		.min(1, { error: 'Enter a name.' })
		.max(MAX_CLIENT_NAME_LENGTH, { error: 'Use a shorter name.' }),
	// Normalised to E.164 with the shop's country in the mutation; blank removes the number.
	phone: z.string().trim().max(30, { error: 'Enter a valid phone number.' }).default(''),
	email: z
		.string()
		.trim()
		.toLowerCase()
		.optional()
		.transform((value) => value || undefined)
		.pipe(z.email({ error: 'Enter a valid email or leave it blank.' }).max(254).optional()),
};

export const clientContactSchema = z.object({ clientId: idSchema, ...contactFields });
export type ClientContactInput = z.output<typeof clientContactSchema>;

export const mergeClientsSchema = z.object({
	keepId: idSchema,
	mergeId: idSchema,
	...contactFields,
});
export type MergeClientsInput = z.output<typeof mergeClientsSchema>;

export const clientNoteSchema = z.object({
	clientId: idSchema,
	body: z
		.string({ error: 'Write a note.' })
		.trim()
		.min(1, { error: 'Write a note.' })
		.max(MAX_NOTE_LENGTH, { error: `Keep notes under ${MAX_NOTE_LENGTH} characters.` }),
});
export type ClientNoteInput = z.output<typeof clientNoteSchema>;
