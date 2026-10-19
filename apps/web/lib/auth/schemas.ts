import { z } from 'zod';

export const emailSchema = z
	.string()
	.trim()
	.toLowerCase()
	.pipe(z.email({ error: 'Enter a valid email address.' }));

export const signInSchema = z.object({
	email: emailSchema,
	password: z.string().min(1, { error: 'Enter your password.' }),
});

export const signUpSchema = z.object({
	name: z.string().trim().min(1, { error: 'Enter your name.' }).max(80),
	email: emailSchema,
	// bcrypt only uses the first 72 bytes.
	password: z
		.string()
		.min(8, { error: 'Use at least 8 characters.' })
		.max(72, { error: 'Use 72 characters or fewer.' }),
});
