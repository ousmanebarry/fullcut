import { getCurrentShop, toActor } from '@/lib/auth/session';
import { exportFileName, startExport } from '@/lib/export';
import { createClient } from '@/lib/supabase/server';
import { timeZone, type Instant } from '@/lib/time';

// POST with a same-origin check, so link prefetching or a cross-site form can't start an export.
export async function POST(request: Request): Promise<Response> {
	const origin = request.headers.get('origin');
	if (!origin || origin !== new URL(request.url).origin) {
		return Response.json({ error: 'Forbidden' }, { status: 403 });
	}

	const ctx = await getCurrentShop();
	if (!ctx) return Response.json({ error: 'Sign in first.' }, { status: 401 });

	const shop = {
		id: ctx.shop.id,
		slug: ctx.shop.slug,
		timezone: timeZone(ctx.shop.timezone),
		currency: ctx.shop.currency,
	};
	const result = await startExport(await createClient(), toActor(ctx), shop);
	if (!result.ok) return Response.json({ error: result.error.message }, { status: 403 });

	return new Response(result.value, {
		headers: {
			'Content-Type': 'application/zip',
			'Content-Disposition': `attachment; filename="${exportFileName(shop, Date.now() as Instant)}"`,
			'Cache-Control': 'no-store',
		},
	});
}
