import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { ClaimOffer } from '@/components/booking/claim-offer';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Instant } from '@/lib/time';
import { findOfferByToken } from '@/lib/waitlist/claim';
import { OFFER_CLOSED_MESSAGES } from '@/lib/waitlist/responses';

export const metadata: Metadata = {
	title: 'A spot opened · Fullcut',
	robots: { index: false, follow: false },
};

export default function ClaimPage({ params }: PageProps<'/w/[token]'>) {
	return (
		<main className="mx-auto grid w-full max-w-lg gap-6 px-4 py-6">
			<Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
				<Offer params={params} />
			</Suspense>
		</main>
	);
}

async function loadOffer(token: string) {
	await connection();
	return findOfferByToken(createAdminClient(), token, Date.now() as Instant);
}

async function Offer({ params }: Pick<PageProps<'/w/[token]'>, 'params'>) {
	const { token } = await params;
	const offer = await loadOffer(token);

	if (!offer) {
		return (
			<div className="grid gap-2 text-center">
				<h1 className="text-2xl font-semibold">This link isn&apos;t valid</h1>
				<p className="text-sm text-muted-foreground">
					It may have been mistyped. Contact the shop if you need help.
				</p>
			</div>
		);
	}

	return (
		<ClaimOffer
			token={token}
			shop={{ slug: offer.shop.slug, name: offer.shop.name }}
			booking={offer.booking}
			expiresLabel={offer.expiresLabel}
			closedMessage={offer.state === 'open' ? null : OFFER_CLOSED_MESSAGES[offer.state]}
		/>
	);
}
