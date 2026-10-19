import { CheckCircle2Icon, CircleIcon } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { requireShopMember } from '@/lib/auth/session';
import { setupProgress } from '@/lib/shop/queries';

export const metadata: Metadata = { title: 'Dashboard · Fullcut' };

export default function DashboardPage() {
	return (
		<Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
			<Overview />
		</Suspense>
	);
}

async function Overview() {
	const ctx = await requireShopMember();
	const progress = await setupProgress(ctx);
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

	return (
		<div className="grid gap-6">
			<div className="grid gap-1">
				<h1 className="text-2xl font-semibold">{ctx.shop.name}</h1>
				<p className="text-sm text-muted-foreground">Your calendar arrives here soon.</p>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>{remaining === 0 ? 'Your shop is ready' : 'Finish setting up'}</CardTitle>
					<CardDescription>
						{remaining === 0
							? 'Everything clients need to book is in place.'
							: `${remaining} ${remaining === 1 ? 'step' : 'steps'} left before clients can book.`}
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
		</div>
	);
}
