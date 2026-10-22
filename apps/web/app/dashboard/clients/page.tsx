import { ChevronRightIcon } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { TableSkeleton } from '@/components/skeletons';
import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table';
import { nativeControlClass } from '@/components/forms/fields';
import { PageHeader } from '@/components/layout/page-header';
import { requireShopMember } from '@/lib/auth/session';
import { listClients } from '@/lib/clients/queries';
import { clientListParamsSchema, type ClientListParams } from '@/lib/clients/schemas';
import { CLIENT_SORT_LABELS, CLIENT_SORTS } from '@/lib/clients/types';
import { toBookingShop } from '@/lib/public-booking/data';
import { createClient } from '@/lib/supabase/server';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Clients' };

export default function ClientsPage({ searchParams }: PageProps<'/dashboard/clients'>) {
	return (
		<div className="mx-auto grid w-full max-w-5xl gap-4">
			<PageHeader title="Clients" />
			<Suspense fallback={<TableSkeleton label="Loading clients…" />}>
				<ClientList searchParams={searchParams} />
			</Suspense>
		</div>
	);
}

function pageHref(params: ClientListParams, page: number) {
	const query = new URLSearchParams();
	if (params.q) query.set('q', params.q);
	if (params.sort !== 'name') query.set('sort', params.sort);
	if (page > 1) query.set('page', String(page));
	const qs = query.toString();
	return qs ? `/dashboard/clients?${qs}` : '/dashboard/clients';
}

async function ClientList({
	searchParams,
}: {
	searchParams: PageProps<'/dashboard/clients'>['searchParams'];
}) {
	const ctx = await requireShopMember();
	const raw = await searchParams;
	const params = clientListParamsSchema.parse(
		Object.fromEntries(
			Object.entries(raw).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
		),
	);
	const db = await createClient();
	const list = await listClients(db, toBookingShop(ctx.shop), params);

	return (
		<>
			<form
				role="search"
				className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2 sm:flex sm:flex-wrap"
				action="/dashboard/clients"
			>
				<div className="col-span-2 grid gap-1.5 sm:min-w-48 sm:flex-1">
					<label htmlFor="client-search" className="text-sm font-medium">
						Name or phone
					</label>
					<Input
						id="client-search"
						name="q"
						type="search"
						defaultValue={params.q}
						autoComplete="off"
						className="h-9"
					/>
				</div>
				<div className="grid gap-1.5">
					<label htmlFor="client-sort" className="text-sm font-medium">
						Sort by
					</label>
					<select
						id="client-sort"
						name="sort"
						defaultValue={params.sort}
						className={cn(nativeControlClass, 'sm:w-auto')}
					>
						{CLIENT_SORTS.map((sort) => (
							<option key={sort} value={sort}>
								{CLIENT_SORT_LABELS[sort]}
							</option>
						))}
					</select>
				</div>
				<button type="submit" className={buttonVariants({ size: 'lg' })}>
					Search
				</button>
			</form>

			<p className="text-sm text-muted-foreground" aria-live="polite">
				{list.total === 1 ? '1 client' : `${list.total} clients`}
				{params.q ? ` matching “${params.q}”` : null}
			</p>

			{list.rows.length === 0 && params.q ? (
				<p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
					No clients match that search.
				</p>
			) : list.rows.length === 0 ? (
				<div className="grid justify-items-center gap-3 rounded-lg border border-dashed p-8 text-center">
					<p className="font-medium">No clients yet</p>
					<p className="max-w-sm text-sm text-muted-foreground">
						Clients are added automatically when they book through your page, or when you add a
						booking yourself.
					</p>
					<div className="flex flex-wrap justify-center gap-2">
						<Link href="/dashboard/calendar?new=1" className={buttonVariants({ size: 'lg' })}>
							New booking
						</Link>
						{ctx.shop.booking_page_enabled ? (
							<Link
								href={`/${ctx.shop.slug}`}
								target="_blank"
								className={buttonVariants({ variant: 'outline', size: 'lg' })}
							>
								Open your booking page
							</Link>
						) : null}
					</div>
				</div>
			) : (
				<>
					<ul className="grid gap-2 md:hidden">
						{list.rows.map((row) => (
							<li key={row.id}>
								<Link
									href={`/dashboard/clients/${row.id}`}
									className="flex items-center gap-3 rounded-xl border bg-card p-4 hover:bg-accent/50"
								>
									<span className="grid min-w-0 flex-1 gap-0.5">
										<span className="truncate font-medium">{row.name}</span>
										<span className="truncate text-sm text-muted-foreground">
											{[
												row.lastVisitLabel ? `Last visit ${row.lastVisitLabel}` : 'No visits yet',
												`${row.visits} ${row.visits === 1 ? 'visit' : 'visits'}`,
												row.noShows > 0
													? `${row.noShows} no-show${row.noShows === 1 ? '' : 's'}`
													: null,
											]
												.filter(Boolean)
												.join(' · ')}
										</span>
										{row.nextBookingLabel ? (
											<span className="truncate text-sm text-primary">
												Next: {row.nextBookingLabel}
											</span>
										) : null}
									</span>
									<ChevronRightIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
								</Link>
							</li>
						))}
					</ul>
					<div className="hidden md:block">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Name</TableHead>
									<TableHead className="hidden sm:table-cell">Phone</TableHead>
									<TableHead>Last visit</TableHead>
									<TableHead className="text-right">Visits</TableHead>
									<TableHead className="hidden text-right md:table-cell">No-shows</TableHead>
									<TableHead className="hidden md:table-cell">Next booking</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{list.rows.map((row) => (
									<TableRow key={row.id} data-testid="client-row">
										<TableCell className="font-medium">
											<Link href={`/dashboard/clients/${row.id}`} className="hover:underline">
												{row.name}
											</Link>
										</TableCell>
										<TableCell className="hidden tabular-nums sm:table-cell">
											{row.phone ?? '–'}
										</TableCell>
										<TableCell>{row.lastVisitLabel ?? '–'}</TableCell>
										<TableCell className="text-right tabular-nums">{row.visits}</TableCell>
										<TableCell className="hidden text-right tabular-nums md:table-cell">
											{row.noShows}
										</TableCell>
										<TableCell className="hidden md:table-cell">
											{row.nextBookingLabel ?? '–'}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
				</>
			)}

			{list.pageCount > 1 ? (
				<nav aria-label="Pages" className="flex items-center justify-between gap-2">
					{list.page > 1 ? (
						<Link
							href={pageHref(params, list.page - 1)}
							className={buttonVariants({ variant: 'outline' })}
						>
							Previous
						</Link>
					) : (
						<span />
					)}
					<span className="text-sm text-muted-foreground">
						Page {list.page} of {list.pageCount}
					</span>
					{list.page < list.pageCount ? (
						<Link
							href={pageHref(params, list.page + 1)}
							className={buttonVariants({ variant: 'outline' })}
						>
							Next
						</Link>
					) : (
						<span />
					)}
				</nav>
			) : null}
		</>
	);
}
