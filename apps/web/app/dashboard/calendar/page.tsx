import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CalendarShell } from '@/components/dashboard/calendar-shell';
import { requireShopMember, toActor } from '@/lib/auth/session';
import { calendarParamsSchema } from '@/lib/dashboard/schemas';
import { currentInstant, loadCalendar } from '@/lib/dashboard/views';
import { toBookingShop } from '@/lib/public-booking/data';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Calendar · Fullcut' };

export default function CalendarPage({ searchParams }: PageProps<'/dashboard/calendar'>) {
	return (
		<Suspense fallback={<p className="text-sm text-muted-foreground">Loading calendar…</p>}>
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
	const model = await loadCalendar(
		db,
		toBookingShop(ctx.shop),
		toActor(ctx),
		params,
		currentInstant(),
	);
	return <CalendarShell model={model} isOwner={ctx.role === 'owner'} />;
}
