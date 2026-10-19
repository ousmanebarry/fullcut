import type { Metadata } from 'next';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { BookingFlow } from '@/components/booking/booking-flow';
import { getCachedPublicShop } from '@/lib/public-booking/cached';
import type { PublicShop } from '@/lib/public-booking/types';

export async function generateMetadata({ params }: PageProps<'/[shopSlug]'>): Promise<Metadata> {
	const { shopSlug } = await params;
	const shop = await getCachedPublicShop(shopSlug);
	if (!shop) return { title: 'Booking page not found · Fullcut' };
	return {
		title: `Book with ${shop.name}`,
		description: shop.aboutText ?? `Book an appointment with ${shop.name} online.`,
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
		<div aria-busy className="grid gap-6">
			<span className="sr-only">Loading booking page…</span>
			<div className="flex items-center gap-3" aria-hidden>
				<div className="size-14 animate-pulse rounded-xl bg-muted" />
				<div className="h-7 w-48 animate-pulse rounded bg-muted" />
			</div>
			<div className="grid gap-2" aria-hidden>
				{Array.from({ length: 4 }, (_, i) => (
					<div key={i} className="h-16 animate-pulse rounded-xl bg-muted" />
				))}
			</div>
		</div>
	);
}
