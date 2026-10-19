import { z } from 'zod';

const publicSchema = z.object({
	supabaseUrl: z.url(),
	supabasePublishableKey: z.string().min(1),
});

const serverSchema = publicSchema.extend({
	supabaseSecretKey: z.string().min(1),
});

export type PublicEnv = z.infer<typeof publicSchema>;
export type ServerEnv = z.infer<typeof serverSchema>;

// Read lazily so `next build` works without Supabase credentials.
export function getPublicEnv(): PublicEnv {
	return publicSchema.parse({
		// NEXT_PUBLIC_* must be referenced literally to be inlined into the browser bundle.
		supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
		supabasePublishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
	});
}

export function getServerEnv(): ServerEnv {
	return serverSchema.parse({
		...getPublicEnv(),
		supabaseSecretKey: process.env.SUPABASE_SECRET_KEY,
	});
}

// Base URL for links in auth emails; never derived from the request Host header.
export function getSiteUrl(): string {
	const fallback = process.env.NODE_ENV === 'production' ? undefined : 'http://localhost:3000';
	return z.url().parse(process.env.SITE_URL ?? fallback);
}
