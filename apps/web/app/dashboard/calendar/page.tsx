import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CalendarSkeleton } from '@/components/skeletons';
import { CalendarShell } from '@/components/dashboard/calendar-shell';
import { requireShopMember, toActor } from '@/lib/auth/session';
import { loadClientMatch } from '@/lib/dashboard/queries';
import { calendarParamsSchema } from '@/lib/dashboard/schemas';
import { currentInstant, loadCalendar } from '@/lib/dashboard/views';
import { toBookingShop } from '@/lib/public-booking/data';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Calendar' };

export default function CalendarPage({ searchParams }: PageProps<'/dashboard/calendar'>) {
	return (
		<Suspense fallback={<CalendarSkeleton />}>
			<Calendar searchParams={searchParams} />
		</Suspense>
	);
}

async function Calendar({
	searchParams,
}: {
	searchParams: PageProps<'/dashboard/calendar'>['searchParams'];
}) {
	// Membership first: it awaits connection(), and date parsing reads the clock (Luxon).
	const ctx = await requireShopMember();
	const raw = await searchParams;
	const params = calendarParamsSchema.parse(
		Object.fromEntries(
			Object.entries(raw).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
		),
	);
	const db = await createClient();
	const [model, prefillClient] = await Promise.all([
		loadCalendar(db, toBookingShop(ctx.shop), toActor(ctx), params, currentInstant()),
		params.new && params.client ? loadClientMatch(db, ctx.shop.id, params.client) : null,
	]);
	return (
		<CalendarShell model={model} isOwner={ctx.role === 'owner'} prefillClient={prefillClient} />
	);
}
