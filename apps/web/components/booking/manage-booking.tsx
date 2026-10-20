'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { FormError } from '@/components/forms/fields';
import { Button } from '@/components/ui/button';
import type { BookingStatus } from '@/lib/booking/types';
import { formatCents } from '@/lib/money/format';
import { cancelBooking, rescheduleBooking, resumeCheckout } from '@/lib/public-booking/client-api';
import type { ManagedPayment } from '@/lib/public-booking/manage';
import type { BookingDetails, PublicSlot, PublicStaff } from '@/lib/public-booking/types';
import { AddToCalendarButton } from './add-to-calendar';
import { BookingSummary } from './booking-summary';
import { DepositNotice } from './deposit-notice';
import { SlotSuggestions } from './slot-suggestions';
import { TimePicker } from './time-picker';

const STATUS_LABELS: Record<BookingStatus, string> = {
	pending: 'Awaiting deposit',
	confirmed: 'Confirmed',
	completed: 'Completed',
	cancelled: 'Cancelled',
	no_show: 'Missed',
};

// The webhook usually lands within seconds of Stripe's redirect; poll briefly, then stop.
const POLL_INTERVAL_MS = 2000;
const POLL_ATTEMPTS = 15;

export interface ManageBookingProps {
	token: string;
	reference: string;
	status: BookingStatus;
	booking: BookingDetails;
	canCancel: boolean;
	canReschedule: boolean;
	changeDeadline: string;
	shop: { slug: string; name: string; phone: string | null; timezone: string };
	serviceId: string;
	staff: PublicStaff[];
	staffId: string;
	payment: ManagedPayment | null;
	/** What cancelling now would refund; null when no deposit has been paid. */
	refundIfCancelled: number | null;
	/** Shop-local end of the hold, for a booking awaiting its deposit. */
	holdUntil: string | null;
	/** Set when the client has just come back from Stripe Checkout. */
	checkoutReturn: 'success' | 'cancelled' | null;
}

type Mode = 'view' | 'cancel' | 'reschedule';

export function ManageBooking(props: ManageBookingProps) {
	const { token, reference, status, booking, shop, payment } = props;
	const router = useRouter();
	const [mode, setMode] = useState<Mode>('view');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [suggestions, setSuggestions] = useState<PublicSlot[]>([]);
	const [notice, setNotice] = useState<string | null>(null);
	const [staffChoice, setStaffChoice] = useState(
		props.staff.some((s) => s.id === props.staffId) ? props.staffId : 'any',
	);
	const [slot, setSlot] = useState<PublicSlot | null>(null);
	const [stillWaiting, setStillWaiting] = useState(false);
	const statusRef = useRef<HTMLParagraphElement>(null);
	const confirming = status === 'pending' && props.checkoutReturn === 'success';

	useEffect(() => {
		if (!confirming) return;
		let attempts = 0;
		const timer = setInterval(() => {
			attempts += 1;
			if (attempts > POLL_ATTEMPTS) {
				clearInterval(timer);
				setStillWaiting(true);
				return;
			}
			router.refresh();
		}, POLL_INTERVAL_MS);
		return () => clearInterval(timer);
	}, [confirming, router]);

	async function payDeposit() {
		setBusy(true);
		setError(null);
		const result = await resumeCheckout(token);
		if (result.ok) {
			window.location.assign(result.data.checkoutUrl);
			return;
		}
		setBusy(false);
		setError(result.error.message);
	}

	function done(message: string) {
		setMode('view');
		setSlot(null);
		setSuggestions([]);
		setError(null);
		setNotice(message);
		router.refresh();
		statusRef.current?.focus();
	}

	async function confirmCancel() {
		setBusy(true);
		const result = await cancelBooking(token);
		setBusy(false);
		if (result.ok) done('Your booking is cancelled.');
		else setError(result.error.message);
	}

	async function confirmReschedule() {
		if (!slot) return;
		setBusy(true);
		const result = await rescheduleBooking(token, staffChoice, slot.startsAt);
		setBusy(false);
		if (result.ok) {
			done(`Moved to ${result.data.booking.label}.`);
			return;
		}
		setError(result.error.message);
		setSuggestions('suggestions' in result.error ? result.error.suggestions : []);
	}

	const shopContact = shop.phone ? (
		<a href={`tel:${shop.phone}`} className="font-medium underline underline-offset-4">
			{shop.phone}
		</a>
	) : (
		'the shop'
	);

	return (
		<div className="grid gap-5">
			<header className="grid gap-1">
				<p className="text-sm text-muted-foreground">{shop.name}</p>
				<h1 className="text-2xl font-semibold">Your booking</h1>
				<p ref={statusRef} tabIndex={-1} className="text-sm outline-none" aria-live="polite">
					<span className="font-medium">{STATUS_LABELS[status]}</span>
					<span className="text-muted-foreground"> · Reference </span>
					<span className="font-mono font-semibold">{reference}</span>
					{notice ? <span className="block pt-1 text-muted-foreground">{notice}</span> : null}
				</p>
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
				{booking.shopAddress ? (
					<p className="pt-2 text-sm text-muted-foreground">{booking.shopAddress}</p>
				) : null}
			</div>

			{status === 'pending' && mode === 'view' ? (
				<section aria-labelledby="pay-title" className="grid gap-2 rounded-lg border p-4">
					<h2 id="pay-title" className="font-semibold">
						{confirming ? 'Confirming your payment…' : 'Pay the deposit to confirm'}
					</h2>
					{confirming ? (
						<p className="text-sm text-muted-foreground" aria-live="polite">
							{stillWaiting
								? "It's taking longer than usual. Refresh this page in a minute; you won't be charged twice."
								: 'This usually takes a few seconds.'}
						</p>
					) : (
						<>
							<p className="text-sm text-muted-foreground">
								{props.checkoutReturn === 'cancelled' ? 'Payment not finished. ' : null}
								{props.holdUntil
									? `Your time is held until ${props.holdUntil}. Nothing has been charged yet.`
									: 'Nothing has been charged yet.'}
							</p>
							<FormError message={error ?? undefined} />
							<Button
								type="button"
								size="lg"
								className="h-11 justify-self-start"
								disabled={busy}
								onClick={payDeposit}
							>
								{busy
									? 'Opening secure payment…'
									: `Pay ${formatCents(booking.depositCents, booking.currency)} deposit`}
							</Button>
						</>
					)}
				</section>
			) : null}

			{payment && payment.state !== 'expired' ? (
				<DepositNotice
					depositCents={payment.amountCents}
					priceCents={booking.priceCents}
					currency={booking.currency}
					policy={payment.policy}
					paid={payment.state !== 'awaiting_payment'}
				/>
			) : null}
			{payment && payment.refundedCents > 0 ? (
				<p className="text-sm">
					<span className="font-medium">
						Refunded {formatCents(payment.refundedCents, booking.currency)}.
					</span>{' '}
					<span className="text-muted-foreground">
						It can take 5–10 business days to appear on your card.
					</span>
				</p>
			) : payment?.state === 'refund_pending' ? (
				<p className="text-sm font-medium">Your deposit refund is on its way.</p>
			) : null}

			{status === 'confirmed' || status === 'pending' ? (
				<div className="flex flex-wrap gap-2">
					<AddToCalendarButton booking={booking} reference={reference} />
				</div>
			) : null}

			{status === 'cancelled' ? (
				<a
					href={`/${shop.slug}`}
					className="inline-flex h-11 items-center justify-self-start rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
				>
					Book again
				</a>
			) : null}

			{mode === 'view' && (props.canCancel || props.canReschedule) ? (
				<div className="grid gap-2">
					<p className="text-sm text-muted-foreground">
						You can change or cancel online until {props.changeDeadline}.
					</p>
					<div className="flex flex-wrap gap-2">
						{props.canReschedule ? (
							<Button
								type="button"
								size="lg"
								className="h-11"
								onClick={() => {
									setNotice(null);
									setMode('reschedule');
								}}
							>
								Reschedule
							</Button>
						) : null}
						{props.canCancel ? (
							<Button
								type="button"
								variant="outline"
								size="lg"
								className="h-11"
								onClick={() => {
									setNotice(null);
									setMode('cancel');
								}}
							>
								Cancel booking
							</Button>
						) : null}
					</div>
				</div>
			) : null}

			{mode === 'view' &&
			!props.canCancel &&
			!props.canReschedule &&
			(status === 'confirmed' || status === 'pending') ? (
				<p className="text-sm text-muted-foreground">
					It&apos;s too close to your appointment to change it online. Please contact {shopContact}.
				</p>
			) : null}

			{mode === 'cancel' ? (
				<section aria-labelledby="cancel-title" className="grid gap-3 rounded-lg border p-4">
					<h2 id="cancel-title" className="text-lg font-semibold">
						Cancel this booking?
					</h2>
					{status === 'pending' ? (
						<p className="text-sm text-muted-foreground">Nothing has been charged.</p>
					) : props.refundIfCancelled !== null && payment ? (
						<p className="text-sm">
							{props.refundIfCancelled >= payment.amountCents
								? `Your ${formatCents(payment.amountCents, booking.currency)} deposit will be refunded.`
								: props.refundIfCancelled > 0
									? `${formatCents(props.refundIfCancelled, booking.currency)} of your deposit will be refunded.`
									: `It's past the free cancellation time, so the ${formatCents(payment.amountCents, booking.currency)} deposit won't be refunded.`}
						</p>
					) : null}
					<FormError message={error ?? undefined} />
					<div className="flex flex-wrap gap-2">
						<Button
							type="button"
							size="lg"
							className="h-11 bg-red-700 text-white hover:bg-red-800"
							disabled={busy}
							onClick={confirmCancel}
						>
							{busy ? 'Cancelling…' : 'Yes, cancel it'}
						</Button>
						<Button
							type="button"
							variant="outline"
							size="lg"
							className="h-11"
							disabled={busy}
							onClick={() => {
								setError(null);
								setMode('view');
							}}
						>
							Keep my booking
						</Button>
					</div>
				</section>
			) : null}

			{mode === 'reschedule' ? (
				<section aria-labelledby="reschedule-title" className="grid gap-4">
					<div className="flex items-center justify-between gap-2">
						<h2 id="reschedule-title" className="text-lg font-semibold">
							Pick a new time
						</h2>
						<Button
							type="button"
							variant="ghost"
							className="h-11"
							onClick={() => {
								setError(null);
								setSlot(null);
								setMode('view');
							}}
						>
							Keep current time
						</Button>
					</div>
					<TimePicker
						slug={shop.slug}
						timezone={shop.timezone}
						serviceId={props.serviceId}
						staff={props.staff}
						staffChoice={staffChoice}
						onStaffChoiceChange={(choice) => {
							setStaffChoice(choice);
							setSlot(null);
						}}
						selected={slot}
						onPick={(picked) => {
							setError(null);
							setSuggestions([]);
							setSlot(picked);
						}}
						idPrefix="reschedule"
					/>
					<div aria-live="polite" className="grid gap-3">
						<FormError message={error ?? undefined} />
						{suggestions.length > 0 ? (
							<SlotSuggestions
								suggestions={suggestions}
								onPick={(picked) => {
									setError(null);
									setSuggestions([]);
									setSlot(picked);
								}}
							/>
						) : null}
						{slot ? (
							<div className="grid gap-2 rounded-lg border p-3">
								<p className="text-sm">
									Move to <span className="font-medium">{slot.label}</span>?
								</p>
								<Button
									type="button"
									size="lg"
									className="h-11 justify-self-start"
									disabled={busy}
									onClick={confirmReschedule}
								>
									{busy ? 'Saving…' : 'Confirm new time'}
								</Button>
							</div>
						) : null}
					</div>
				</section>
			) : null}
		</div>
	);
}
