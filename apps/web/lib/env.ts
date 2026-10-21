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

const demoSchema = z.object({
	userId: z.uuid(),
	email: z.email(),
	password: z.string().min(12),
	shopSlug: z.string().min(1),
});

export type DemoEnv = z.infer<typeof demoSchema>;

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
	const previewUrl =
		process.env.VERCEL_ENV === 'preview' && process.env.VERCEL_BRANCH_URL
			? `https://${process.env.VERCEL_BRANCH_URL}`
			: undefined;
	const fallback = process.env.NODE_ENV === 'production' ? previewUrl : 'http://localhost:3000';
	return z.url().parse(process.env.SITE_URL ?? fallback);
}

/** The shared demo login, or null when this environment has no demo (local, previews). Server-only. */
export function getDemoEnv(): DemoEnv | null {
	const parsed = demoSchema.safeParse({
		userId: process.env.DEMO_USER_ID,
		email: process.env.DEMO_USER_EMAIL,
		password: process.env.DEMO_PASSWORD,
		shopSlug: process.env.DEMO_SHOP_SLUG,
	});
	return parsed.success ? parsed.data : null;
}

// The password is often a runtime-only (Sensitive) var, so the page decides from the slug alone.
export function getDemoShopSlug(): string | null {
	return process.env.DEMO_SHOP_SLUG || null;
}

export type MessagingMode = 'log' | 'twilio';

/** Real texts only when explicitly turned on; anything else logs instead of sending. */
export function getMessagingMode(): MessagingMode {
	return process.env.MESSAGING_MODE === 'twilio' ? 'twilio' : 'log';
}

const twilioSchema = z.object({
	accountSid: z.string().regex(/^AC[0-9a-f]{32}$/),
	authToken: z.string().min(16),
	messagingServiceSid: z.string().regex(/^MG[0-9a-f]{32}$/),
});

export type TwilioEnv = z.infer<typeof twilioSchema>;

/** Server-only. Throws when MESSAGING_MODE=twilio but the credentials are missing. */
export function getTwilioEnv(): TwilioEnv {
	return twilioSchema.parse({
		accountSid: process.env.TWILIO_ACCOUNT_SID,
		authToken: process.env.TWILIO_AUTH_TOKEN,
		messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
	});
}

/** Server-only. Needed to verify webhooks in every mode; null means webhooks are rejected. */
export function getTwilioAuthToken(): string | null {
	return process.env.TWILIO_AUTH_TOKEN || null;
}

/** Public base URL Twilio calls (signatures cover the full URL); a tunnel URL in local dev. */
export function getTwilioWebhookBaseUrl(): string {
	return z.url().parse(process.env.TWILIO_WEBHOOK_BASE_URL || getSiteUrl());
}

/** Server-only. Bearer secret for /api/jobs/tick; null disables the endpoint. */
export function getJobsSecret(): string | null {
	const secret = process.env.JOBS_SECRET;
	return secret && secret.length >= 32 ? secret : null;
}

const mlSchema = z.object({
	url: z.url(),
	secret: z.string().min(32),
});

export type MlEnv = z.infer<typeof mlSchema>;

/** Server-only. The no-show scoring service; null turns risk scoring off entirely. */
export function getMlEnv(): MlEnv | null {
	const parsed = mlSchema.safeParse({
		url: process.env.ML_SERVICE_URL,
		secret: process.env.ML_SHARED_SECRET,
	});
	return parsed.success ? parsed.data : null;
}
