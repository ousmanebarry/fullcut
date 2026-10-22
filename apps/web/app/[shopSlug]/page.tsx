import type { Metadata } from 'next';
import Image from 'next/image';
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
		<main className="mx-auto grid w-full max-w-lg gap-6 px-4 py-6">
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
			<BookingFlow shop={shop} />
		</>
	);
}

function ShopHeader({ shop }: { shop: PublicShop }) {
	return (
		<header className="flex items-center gap-3">
			{shop.logoUrl ? (
				<Image
					src={shop.logoUrl}
					alt=""
					width={56}
					height={56}
					unoptimized
					className="size-14 shrink-0 rounded-xl border object-cover"
				/>
			) : (
				<div
					aria-hidden
					className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-primary text-xl font-semibold text-primary-foreground"
				>
					{shop.name.slice(0, 1).toUpperCase()}
				</div>
			)}
			<div className="grid min-w-0 gap-0.5">
				<h1 className="truncate text-2xl font-semibold">{shop.name}</h1>
				{shop.address ? <p className="text-sm text-muted-foreground">{shop.address}</p> : null}
				{shop.aboutText ? (
					<p className="line-clamp-2 text-sm text-muted-foreground">{shop.aboutText}</p>
				) : null}
			</div>
		</header>
	);
}

function BookingPageSkeleton() {
	return (
		<div role="status" aria-busy="true" className="grid gap-6">
			<span className="sr-only">Loading booking page…</span>
			<div className="flex items-center gap-3" aria-hidden>
				<Skeleton className="size-14 rounded-xl" />
				<Skeleton className="h-7 w-48" />
			</div>
			<div className="grid gap-2" aria-hidden>
				{Array.from({ length: 4 }, (_, i) => (
					<Skeleton key={i} className="h-16 rounded-xl" />
				))}
			</div>
		</div>
	);
}
