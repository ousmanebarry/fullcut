import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { z } from 'zod';
import { buttonVariants } from '@/components/ui/button';
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table';
import { requireShopOwner } from '@/lib/auth/session';
import { formatCents } from '@/lib/money/format';
import { listPayments } from '@/lib/payments/queries';
import { createClient } from '@/lib/supabase/server';
import { timeZone } from '@/lib/time';

export const metadata: Metadata = { title: 'Payments · Fullcut' };

const pageSchema = z.coerce.number().int().min(1).max(1000).catch(1);

export default function PaymentsPage({ searchParams }: PageProps<'/dashboard/payments'>) {
	return (
		<div className="mx-auto grid w-full max-w-5xl gap-4">
			<div className="grid gap-1">
				<h1 className="text-2xl font-semibold">Payments</h1>
				<p className="text-sm text-muted-foreground">
					Deposits taken online. Open a booking to refund its deposit. Stripe&apos;s own fees are
					shown in your Stripe Dashboard.
				</p>
			</div>
			<Suspense fallback={<p className="text-sm text-muted-foreground">Loading payments…</p>}>
				<PaymentList searchParams={searchParams} />
			</Suspense>
		</div>
	);
}

async function PaymentList({
	searchParams,
}: {
	searchParams: PageProps<'/dashboard/payments'>['searchParams'];
}) {
	const { shop } = await requireShopOwner();
	const raw = (await searchParams).page;
	const page = pageSchema.parse(Array.isArray(raw) ? raw[0] : raw);
	const db = await createClient();
	const { items, hasMore } = await listPayments(db, shop.id, timeZone(shop.timezone), page - 1);

	if (items.length === 0) {
		return (
			<p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
				{page > 1 ? 'No more payments.' : 'No deposits yet.'}{' '}
				<Link href="/dashboard/settings/payments" className="underline underline-offset-4">
					Payment settings
				</Link>
			</p>
		);
	}

	return (
		<>
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Date</TableHead>
						<TableHead>Client</TableHead>
						<TableHead className="hidden md:table-cell">Appointment</TableHead>
						<TableHead className="text-right">Amount</TableHead>
						<TableHead className="hidden text-right sm:table-cell">Fullcut fee</TableHead>
						<TableHead>Status</TableHead>
						<TableHead className="text-right">Refunded</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{items.map((item) => (
						<TableRow key={item.id}>
							<TableCell>{item.dateLabel}</TableCell>
							<TableCell>
								<span className="font-medium">{item.clientName}</span>
								<span className="block text-xs text-muted-foreground">{item.serviceName}</span>
							</TableCell>
							<TableCell className="hidden md:table-cell">{item.appointmentLabel}</TableCell>
							<TableCell className="text-right">
								{formatCents(item.amountCents, item.currency)}
							</TableCell>
							<TableCell className="hidden text-right sm:table-cell">
								{formatCents(item.platformFeeCents, item.currency)}
							</TableCell>
							<TableCell>
								{item.stateLabel}
								{item.refundError ? (
									<span className="block text-xs text-destructive">{item.refundError}</span>
								) : null}
							</TableCell>
							<TableCell className="text-right">
								{item.refundedCents > 0 ? formatCents(item.refundedCents, item.currency) : '—'}
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
			<nav aria-label="Pages" className="flex gap-2">
				{page > 1 ? (
					<Link
						href={page === 2 ? '/dashboard/payments' : `/dashboard/payments?page=${page - 1}`}
						className={buttonVariants({ variant: 'outline' })}
					>
						Newer
					</Link>
				) : null}
				{hasMore ? (
					<Link
						href={`/dashboard/payments?page=${page + 1}`}
						className={buttonVariants({ variant: 'outline' })}
					>
						Older
					</Link>
				) : null}
			</nav>
		</>
	);
}
