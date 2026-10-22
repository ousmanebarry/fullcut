import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { BookingFlow } from '@/components/booking/booking-flow';
import { Skeleton } from '@/components/ui/skeleton';
import { getCachedPublicShop } from '@/lib/public-booking/cached';
import type { PublicShop } from '@/lib/public-booking/types';

export async function generateMetadata({ params }: PageProps<'/[shopSlug]'>): Promise<Metadata> {
	const { shopSlug } = await params;
	const shop = await getCachedPublicShop(shopSlug);
	if (!shop) return { title: 'Booking page not found' };
	const title = `Book with ${shop.name}`;
	const description = shop.aboutText ?? `Book an appointment with ${shop.name} online.`;
	return {
		// The booking page is the shop's own, so no Fullcut suffix.
		title: { absolute: title },
		description,
		openGraph: { title, description, siteName: shop.name },
	};
}

export default function ShopBookingPage({ params }: PageProps<'/[shopSlug]'>) {
	return (
		<main className="mx-auto grid w-full max-w-lg flex-1 content-start gap-6 px-4 pt-4 pb-10 md:max-w-5xl md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] md:items-start md:gap-10 md:py-12">
			<Suspense fallback={<BookingPageSkeleton />}>
				<ShopBooking params={params} />
			</Suspense>
		</main>
	);
}

async function ShopBooking({ params }: Pick<PageProps<'/[shopSlug]'>, 'params'>) {
	const { shopSlug } = await params;
	const shop = await getCachedPublicShop(shopSlug);
	if (!shop) notFound();
	return (
		<>
			<ShopHeader shop={shop} />
			<div className="grid gap-6 md:rounded-2xl md:border md:bg-card md:p-6 md:shadow-sm">
				<BookingFlow shop={shop} />
			</div>
			<p className="text-center text-xs text-muted-foreground md:col-start-2">
				Booking by{' '}
				<Link href="/" className="font-medium hover:underline">
					Fullcut
				</Link>
			</p>
		</>
	);
}

function ShopHeader({ shop }: { shop: PublicShop }) {
	return (
		<header className="flex items-center gap-3 md:sticky md:top-12 md:grid md:gap-4 md:rounded-2xl md:border md:bg-card md:p-6 md:shadow-sm">
			{shop.logoUrl ? (
				<Image
					src={shop.logoUrl}
					alt=""
					width={80}
					height={80}
					unoptimized
					className="size-14 shrink-0 rounded-xl border object-cover md:size-20 md:rounded-2xl"
				/>
			) : (
				<div
					aria-hidden
					className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-primary text-xl font-semibold text-primary-foreground md:size-20 md:rounded-2xl md:text-3xl"
				>
					{shop.name.slice(0, 1).toUpperCase()}
				</div>
			)}
			<div className="grid min-w-0 gap-0.5 md:gap-2">
				<h1 className="truncate text-2xl font-semibold tracking-tight md:whitespace-normal">
					{shop.name}
				</h1>
				{shop.address ? <p className="text-sm text-muted-foreground">{shop.address}</p> : null}
				{shop.phone ? (
					<a
						href={`tel:${shop.phone}`}
						className="hidden w-fit text-sm font-medium text-primary hover:underline md:block"
					>
						{shop.phone}
					</a>
				) : null}
				{shop.aboutText ? (
					<p className="line-clamp-2 text-sm text-muted-foreground md:line-clamp-none">
						{shop.aboutText}
					</p>
				) : null}
			</div>
		</header>
	);
}

function BookingPageSkeleton() {
	return (
		<div role="status" aria-busy="true" className="contents">
			<span className="sr-only">Loading booking page…</span>
			<div className="flex items-center gap-3 md:grid md:rounded-2xl md:border md:p-6" aria-hidden>
				<Skeleton className="size-14 rounded-xl md:size-20" />
				<Skeleton className="h-7 w-48" />
			</div>
			<div className="grid gap-2 md:rounded-2xl md:border md:p-6" aria-hidden>
				{Array.from({ length: 4 }, (_, i) => (
					<Skeleton key={i} className="h-16 rounded-xl" />
				))}
			</div>
		</div>
	);
}
