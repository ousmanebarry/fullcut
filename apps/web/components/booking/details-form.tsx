'use client';

import { useEffect, useRef, useState } from 'react';
import { FieldShell, FormError, describedBy } from '@/components/forms/fields';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { formatCents } from '@/lib/money/format';
import { HOLD_MINUTES } from '@/lib/payments/policy';
import { createBooking } from '@/lib/public-booking/client-api';
import type {
	BookingCreated,
	PublicApiError,
	PublicShop,
	PublicSlot,
} from '@/lib/public-booking/types';
import { BookingSummary, type SummaryItem } from './booking-summary';
import { DepositNotice } from './deposit-notice';
import { SlotSuggestions } from './slot-suggestions';

type PhoneLib = typeof import('libphonenumber-js/min');

export interface DetailsFormProps {
	shop: PublicShop;
	serviceId: string;
	staffChoice: string;
	slot: PublicSlot;
	summary: SummaryItem;
	/** Deposit shown on the page; the server refuses the booking if it has changed. */
	depositCents: number;
	onSlotChange: (slot: PublicSlot) => void;
	onBooked: (created: BookingCreated) => void;
}

interface Values {
	name: string;
	phone: string;
	email: string;
	notes: string;
	marketingOptIn: boolean;
	website: string;
}

const EMPTY: Values = {
	name: '',
	phone: '',
	email: '',
	notes: '',
	marketingOptIn: false,
	website: '',
};

export function DetailsForm({
	shop,
	serviceId,
	staffChoice,
	slot,
	summary,
	depositCents,
	onSlotChange,
	onBooked,
}: DetailsFormProps) {
	const [values, setValues] = useState<Values>(EMPTY);
	const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
	const [apiError, setApiError] = useState<PublicApiError | null>(null);
	const [submitting, setSubmitting] = useState(false);
	const [redirecting, setRedirecting] = useState(false);
	const [deposit, setDeposit] = useState(depositCents);
	const phoneLib = useRef<PhoneLib | null>(null);
	const errorRef = useRef<HTMLDivElement>(null);

	// Loaded on this step only, to keep the first page load small; formats anything typed meanwhile.
	useEffect(() => {
		void import('libphonenumber-js/min').then((lib) => {
			phoneLib.current = lib;
			setValues((v) =>
				v.phone ? { ...v, phone: new lib.AsYouType(shop.country).input(v.phone) } : v,
			);
		});
	}, [shop.country]);

	useEffect(() => {
		if (apiError) errorRef.current?.focus();
	}, [apiError]);

	const set = <K extends keyof Values>(key: K, value: Values[K]) =>
		setValues((v) => ({ ...v, [key]: value }));

	function onPhoneChange(next: string) {
		const lib = phoneLib.current;
		// Formatting while deleting would fight the user, so only format as digits are added.
		const formatted =
			lib && next.length > values.phone.length ? new lib.AsYouType(shop.country).input(next) : next;
		set('phone', formatted);
	}

	function validate(): Record<string, string> {
		const errors: Record<string, string> = {};
		if (!values.name.trim()) errors.name = 'Enter your name.';
		if (!values.phone.trim()) errors.phone = 'Enter your mobile number.';
		else if (phoneLib.current && !phoneLib.current.isValidPhoneNumber(values.phone, shop.country)) {
			errors.phone = 'Enter a valid mobile number.';
		}
		if (values.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) {
			errors.email = 'Enter a valid email or leave it blank.';
		}
		return errors;
	}

	async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (submitting) return;
		const errors = validate();
		setFieldErrors(errors);
		setApiError(null);
		if (Object.keys(errors).length > 0) {
			const first = Object.keys(errors)[0];
			if (first) document.getElementById(`details-${first}`)?.focus();
			return;
		}

		setSubmitting(true);
		const source = new URLSearchParams(window.location.search).get('src');
		const result = await createBooking(
			shop.slug,
			{
				serviceId,
				staffId: staffChoice,
				startsAt: slot.startsAt,
				name: values.name,
				phone: values.phone,
				email: values.email || undefined,
				notes: values.notes || undefined,
				marketingOptIn: values.marketingOptIn,
				expectedDepositCents: deposit,
				website: values.website,
			},
			source,
		);

		if (result.ok && result.data.checkoutUrl) {
			// The slot is held while the client pays on Stripe's page; they come back to their booking page.
			setRedirecting(true);
			window.location.assign(result.data.checkoutUrl);
			return;
		}
		setSubmitting(false);

		if (result.ok) {
			onBooked(result.data);
			return;
		}
		if (result.error.error === 'deposit_changed') setDeposit(result.error.depositCents);
		if (result.error.error === 'invalid_request' && result.error.fieldErrors) {
			setFieldErrors(result.error.fieldErrors);
		}
		setApiError(result.error);
	}

	const suggestions =
		apiError && 'suggestions' in apiError && apiError.suggestions.length > 0
			? apiError.suggestions
			: null;

	return (
		<form onSubmit={onSubmit} noValidate className="grid gap-4">
			<div ref={errorRef} tabIndex={-1} className="grid gap-2 outline-none">
				<FormError message={apiError?.message} />
				{suggestions ? (
					<SlotSuggestions
						suggestions={suggestions}
						onPick={(s) => {
							setApiError(null);
							onSlotChange(s);
						}}
					/>
				) : null}
			</div>

			<FieldShell id="details-name" label="Name" error={fieldErrors.name}>
				<Input
					id="details-name"
					name="name"
					autoComplete="name"
					className="h-11"
					required
					maxLength={80}
					value={values.name}
					onChange={(e) => set('name', e.target.value)}
					{...describedBy('details-name', fieldErrors.name)}
				/>
			</FieldShell>

			<FieldShell
				id="details-phone"
				label="Mobile number"
				hint="For your confirmation and reminders."
				error={fieldErrors.phone}
			>
				<Input
					id="details-phone"
					name="phone"
					type="tel"
					inputMode="tel"
					autoComplete="tel"
					className="h-11"
					required
					value={values.phone}
					onChange={(e) => onPhoneChange(e.target.value)}
					{...describedBy('details-phone', fieldErrors.phone, 'hint')}
				/>
			</FieldShell>

			<FieldShell id="details-email" label="Email (optional)" error={fieldErrors.email}>
				<Input
					id="details-email"
					name="email"
					type="email"
					autoComplete="email"
					className="h-11"
					value={values.email}
					onChange={(e) => set('email', e.target.value)}
					{...describedBy('details-email', fieldErrors.email)}
				/>
			</FieldShell>

			<FieldShell
				id="details-notes"
				label="Notes for the shop (optional)"
				error={fieldErrors.notes}
			>
				<Textarea
					id="details-notes"
					name="notes"
					rows={3}
					maxLength={500}
					value={values.notes}
					onChange={(e) => set('notes', e.target.value)}
					{...describedBy('details-notes', fieldErrors.notes)}
				/>
			</FieldShell>

			<label className="flex items-start gap-3 text-sm">
				<input
					type="checkbox"
					name="marketingOptIn"
					className="mt-0.5 size-5 shrink-0 accent-primary"
					checked={values.marketingOptIn}
					onChange={(e) => set('marketingOptIn', e.target.checked)}
				/>
				<span>
					Send me occasional offers and rebooking reminders from {shop.name}. You can opt out
					anytime.
				</span>
			</label>

			{/* Honeypot: off-screen and skipped by keyboard and screen readers; bots fill it in. */}
			<div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
				<label htmlFor="details-website">Website</label>
				<input
					id="details-website"
					name="website"
					tabIndex={-1}
					autoComplete="off"
					value={values.website}
					onChange={(e) => set('website', e.target.value)}
				/>
			</div>

			<div className="rounded-lg border bg-muted/40 p-3">
				<BookingSummary item={summary} />
			</div>

			{deposit > 0 ? (
				<DepositNotice
					depositCents={deposit}
					priceCents={summary.priceCents}
					currency={summary.currency}
					policy={shop.cancellationPolicy}
				/>
			) : null}

			<Button type="submit" size="lg" className="h-12 text-base" disabled={submitting}>
				{redirecting
					? 'Opening secure payment…'
					: submitting
						? 'Booking…'
						: deposit > 0
							? `Pay ${formatCents(deposit, summary.currency)} deposit`
							: 'Confirm booking'}
			</Button>
			{deposit > 0 ? (
				<p className="text-xs text-muted-foreground">
					Your time is held for {HOLD_MINUTES} minutes while you pay. If you don&apos;t finish,
					it&apos;s released and nothing is charged.
				</p>
			) : null}
		</form>
	);
}
