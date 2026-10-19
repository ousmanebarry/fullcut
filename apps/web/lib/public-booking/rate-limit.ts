import { createHash } from 'node:crypto';
import type { Db } from '@/lib/shop/settings';

export interface RateLimit {
	max: number;
	windowSeconds: number;
}

export const RATE_LIMITS = {
	bookingPerIp: { max: 10, windowSeconds: 3600 },
	bookingPerPhone: { max: 5, windowSeconds: 3600 },
	managePerIp: { max: 20, windowSeconds: 3600 },
	demoSignInPerIp: { max: 10, windowSeconds: 3600 },
} as const satisfies Record<string, RateLimit>;

// Local dev sees every request as loopback; one shared bucket would block the whole machine.
const LOOPBACK = new Set(['::1', '127.0.0.1', '::ffff:127.0.0.1', 'localhost']);

/** Client IP as reported by the hosting proxy (Vercel sets both headers); null if absent or loopback. */
export function clientIp(headers: Headers): string | null {
	const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
	const ip = forwarded || headers.get('x-real-ip')?.trim() || null;
	return ip && !LOOPBACK.has(ip) ? ip : null;
}

/** Hashed so raw IPs and phone numbers are never stored. */
export function rateLimitKey(kind: string, value: string): string {
	return `${kind}:${createHash('sha256').update(value).digest('hex')}`;
}

export async function hitRateLimit(
	db: Db,
	key: string,
	limit: RateLimit,
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
	const { data, error } = await db
		.rpc('hit_rate_limit', {
			p_key: key,
			p_window_seconds: limit.windowSeconds,
			p_max: limit.max,
		})
		.single();
	if (error) throw error;
	return { allowed: data.allowed, retryAfterSeconds: data.retry_after_seconds };
}
