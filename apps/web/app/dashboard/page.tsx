import { CheckCircle2Icon, CircleIcon, PlusIcon } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { BookingList } from '@/components/dashboard/booking-list';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { requireShopMember, toActor, type ShopContext } from '@/lib/auth/session';
import { currentInstant, loadToday } from '@/lib/dashboard/views';
import { toBookingShop } from '@/lib/public-booking/data';
import { setupProgress } from '@/lib/shop/queries';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Today · Fullcut' };

export default function DashboardPage() {
	return (
		<Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
			<Today />
		</Suspense>
	);
}

async function Today() {
	const ctx = await requireShopMember();
	const db = await createClient();
	const [model, progress] = await Promise.all([
		loadToday(db, toBookingShop(ctx.shop), toActor(ctx), currentInstant()),
		setupProgress(ctx),
	]);

	return (
		<div className="mx-auto grid w-full max-w-3xl gap-6">
			<div className="flex flex-wrap items-end justify-between gap-3">
				<div className="grid gap-1">
					<h1 className="text-2xl font-semibold">Today</h1>
					<p className="text-sm text-muted-foreground">{model.title}</p>
				</div>
				<Link href="/dashboard/calendar?new=1" className={buttonVariants({ size: 'lg' })}>
					<PlusIcon aria-hidden="true" />
					New booking
				</Link>
			</div>

			<SetupChecklist ctx={ctx} progress={progress} />

			{model.unmarked > 0 ? (
				<div
					role="status"
					className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-400 bg-amber-50 p-3 text-sm dark:bg-amber-950/30"
				>
					<span>
						<strong>{model.unmarked}</strong> past{' '}
						{model.unmarked === 1 ? 'appointment needs' : 'appointments need'} an outcome.
					</span>
					<Link
						href="/dashboard/outcomes"
						className={buttonVariants({ variant: 'outline', size: 'sm' })}
					>
						Mark them
					</Link>
				</div>
			) : null}

			<dl className="grid grid-cols-2 gap-3">
				<Stat label="Bookings today" value={model.bookingsToday} />
				<Stat
					label="Open slots left"
					value={model.openSlotsLeft ?? '–'}
					hint="For your shortest service"
				/>
			</dl>

			<section className="grid gap-2" aria-labelledby="today-heading">
				<div className="flex items-center justify-between gap-3">
					<h2 id="today-heading" className="font-medium">
						{model.ownOnly ? 'Your appointments' : 'Appointments'}
					</h2>
					<Link href="/dashboard/calendar" className="text-sm hover:underline">
						Open calendar
					</Link>
				</div>
				<BookingList
					bookings={model.bookings}
					showStaff={!model.ownOnly}
					empty="No appointments today."
				/>
			</section>
		</div>
	);
}

function Stat({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
	return (
		<div className="grid gap-0.5 rounded-lg border p-3">
			<dt className="text-sm text-muted-foreground">{label}</dt>
			<dd className="text-2xl font-semibold tabular-nums">{value}</dd>
			{hint ? <dd className="text-xs text-muted-foreground">{hint}</dd> : null}
		</div>
	);
}

function SetupChecklist({
	ctx,
	progress,
}: {
	ctx: ShopContext;
	progress: Awaited<ReturnType<typeof setupProgress>>;
}) {
	const isOwner = ctx.role === 'owner';

	const steps = [
		{
			done: progress.services > 0,
			label: 'Add your first service',
			href: '/dashboard/settings/services',
			ownerOnly: true,
		},
		{
			done: progress.staff > 0,
			label: 'Add your team',
			href: '/dashboard/settings/staff',
			ownerOnly: true,
		},
		{
			done: progress.rules > 0,
			label: 'Set working hours',
			href: '/dashboard/settings/hours',
			ownerOnly: false,
		},
		{
			done: ctx.shop.booking_page_enabled,
			label: 'Turn on your booking page',
			href: '/dashboard/settings/booking-rules',
			ownerOnly: true,
		},
	].filter((step) => isOwner || !step.ownerOnly);
	const remaining = steps.filter((step) => !step.done).length;
	if (remaining === 0) return null;

	return (
		<Card>
			<CardHeader>
				<CardTitle>Finish setting up</CardTitle>
				<CardDescription>
					{`${remaining} ${remaining === 1 ? 'step' : 'steps'} left before clients can book.`}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<ul className="grid gap-2">
					{steps.map((step) => (
						<li key={step.href} className="flex items-center justify-between gap-3">
							<span className="flex items-center gap-2 text-sm">
								{step.done ? (
									<CheckCircle2Icon className="size-4 text-primary" aria-hidden="true" />
								) : (
									<CircleIcon className="size-4 text-muted-foreground" aria-hidden="true" />
								)}
								<span className={step.done ? 'text-muted-foreground line-through' : undefined}>
									{step.label}
								</span>
								<span className="sr-only">{step.done ? '(done)' : '(to do)'}</span>
							</span>
							{step.done ? null : (
								<Link
									href={step.href}
									className={buttonVariants({ variant: 'outline', size: 'sm' })}
								>
									Go
								</Link>
							)}
						</li>
					))}
				</ul>
			</CardContent>
		</Card>
	);
}
