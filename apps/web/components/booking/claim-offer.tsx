'use client';

import { useRef, useState } from 'react';
import { FormError } from '@/components/forms/fields';
import { Button } from '@/components/ui/button';
import { claimOffer } from '@/lib/public-booking/client-api';
import type { BookingCreated, BookingDetails } from '@/lib/public-booking/types';
import { AddToCalendarButton } from './add-to-calendar';
import { BookingSummary } from './booking-summary';

export interface ClaimOfferProps {
	token: string;
	shop: { slug: string; name: string };
	booking: BookingDetails;
	expiresLabel: string;
	/** Set when the offer can no longer be claimed. */
	closedMessage: string | null;
}

export function ClaimOffer({ token, shop, booking, expiresLabel, closedMessage }: ClaimOfferProps) {
	const [busy, setBusy] = useState(false);
	const [created, setCreated] = useState<BookingCreated | null>(null);
	const [closed, setClosed] = useState(closedMessage);
	const [error, setError] = useState<string | null>(null);
	const headingRef = useRef<HTMLHeadingElement>(null);

	async function claim() {
		setBusy(true);
		setError(null);
		const result = await claimOffer(token);
		setBusy(false);
		if (result.ok) setCreated(result.data);
		else if (result.error.error === 'offer_closed') setClosed(result.error.message);
		else setError(result.error.message);
		headingRef.current?.focus();
	}

	const title = created ? "You're booked" : closed ? 'This spot is gone' : 'A spot opened up';

	return (
		<div className="grid gap-5">
			<header className="grid gap-1">
				<p className="text-sm text-muted-foreground">{shop.name}</p>
				<h1 ref={headingRef} tabIndex={-1} className="text-2xl font-semibold outline-none">
					{title}
				</h1>
			</header>

			<div className="rounded-lg border bg-muted/40 p-3">
				<BookingSummary
					item={{
						serviceName: booking.serviceName,
						staffName: booking.staffName,
						when: booking.label,
						durationMinutes: booking.durationMinutes,
						priceCents: booking.priceCents,
						currency: booking.currency,
					}}
				/>
			</div>

			{created ? (
				<div className="grid gap-3">
					<p className="text-sm">
						Your booking reference is{' '}
						<span className="font-mono font-semibold">{created.reference}</span>. A confirmation
						text is on its way.
					</p>
					<div className="flex flex-wrap gap-2">
						<AddToCalendarButton
							booking={created.booking}
							reference={created.reference}
							manageUrl={created.manageUrl}
						/>
						<a
							href={created.manageUrl}
							className="inline-flex h-11 items-center rounded-lg border px-3 text-sm font-medium outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50"
						>
							Manage booking
						</a>
					</div>
				</div>
			) : closed ? (
				<div className="grid gap-3">
					<p role="status" className="text-sm">
						{closed}
					</p>
					<a
						href={`/${shop.slug}`}
						className="inline-flex h-11 items-center justify-self-start rounded-lg border px-4 text-sm font-medium outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50"
					>
						See other times
					</a>
				</div>
			) : (
				<div className="grid gap-3">
					<p className="text-sm text-muted-foreground">
						First to tap gets it. This offer is open until {expiresLabel}.
					</p>
					<FormError message={error ?? undefined} />
					<Button
						type="button"
						size="lg"
						className="h-12 text-base"
						disabled={busy}
						onClick={claim}
					>
						{busy ? 'Booking…' : 'Book it'}
					</Button>
				</div>
			)}
		</div>
	);
}
