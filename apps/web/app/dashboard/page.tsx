import { CheckCircle2Icon, ChevronRightIcon, CircleIcon, PlusIcon } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { ListSkeleton } from '@/components/skeletons';
import { BookingList } from '@/components/dashboard/booking-list';
import { NewBookingFab } from '@/components/dashboard/new-booking-fab';
import { RefillMetricCard } from '@/components/dashboard/refill-metric';
import { PageHeader } from '@/components/layout/page-header';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { requireShopMember, toActor, type ShopContext } from '@/lib/auth/session';
import { currentInstant, loadToday } from '@/lib/dashboard/views';
import { toBookingShop } from '@/lib/public-booking/data';
import { setupProgress } from '@/lib/shop/queries';
import { createClient } from '@/lib/supabase/server';
import { timeZone } from '@/lib/time';
import { cn } from '@/lib/utils';
import { loadRefillMetric } from '@/lib/waitlist/metrics';

export const metadata: Metadata = { title: 'Today' };

export default function DashboardPage() {
	return (
		<Suspense fallback={<ListSkeleton title className="mx-auto w-full max-w-3xl" />}>
			<Today />
		</Suspense>
	);
}

async function Today() {
	const ctx = await requireShopMember();
	const db = await createClient();
	const now = currentInstant();
	const [model, progress, refill] = await Promise.all([
		loadToday(db, toBookingShop(ctx.shop), toActor(ctx), now),
		setupProgress(ctx),
		loadRefillMetric(db, ctx.shop.id, timeZone(ctx.shop.timezone), now),
	]);

	return (
		<div className="mx-auto grid w-full max-w-3xl gap-6">
			<PageHeader
				title="Today"
				description={model.title}
				actions={
					<Link
						href="/dashboard/calendar?new=1"
						className={cn(buttonVariants({ size: 'lg' }), 'hidden md:inline-flex')}
					>
						<PlusIcon aria-hidden="true" />
						New booking
					</Link>
				}
			/>
			<NewBookingFab />

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

			{ctx.shop.waitlist_enabled || refill.slotsRecovered > 0 ? (
				<RefillMetricCard metric={refill} currency={ctx.shop.currency} />
			) : null}

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
		<div className="grid gap-1 rounded-xl border bg-card p-4">
			<dt className="text-sm text-muted-foreground">{label}</dt>
			<dd className="text-3xl font-semibold tracking-tight tabular-nums">{value}</dd>
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
				<ul className="-mx-2 grid gap-1">
					{steps.map((step) => {
						const content = (
							<>
								{step.done ? (
									<CheckCircle2Icon className="size-5 text-primary" aria-hidden="true" />
								) : (
									<CircleIcon className="size-5 text-muted-foreground" aria-hidden="true" />
								)}
								<span className={cn('flex-1', step.done && 'text-muted-foreground line-through')}>
									{step.label}
								</span>
								<span className="sr-only">{step.done ? '(done)' : '(to do)'}</span>
								{step.done ? null : (
									<ChevronRightIcon className="size-4 text-muted-foreground" aria-hidden="true" />
								)}
							</>
						);
						const rowClass = 'flex min-h-11 items-center gap-3 rounded-lg px-2 text-sm';
						return (
							<li key={step.href}>
								{step.done ? (
									<span className={rowClass}>{content}</span>
								) : (
									<Link href={step.href} className={cn(rowClass, 'font-medium hover:bg-accent')}>
										{content}
									</Link>
								)}
							</li>
						);
					})}
				</ul>
			</CardContent>
		</Card>
	);
}
