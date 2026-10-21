'use client';

import { useEffect, useRef, useState } from 'react';
import { FieldShell, FormError, describedBy, nativeControlClass } from '@/components/forms/fields';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { joinWaitlist } from '@/lib/public-booking/client-api';
import { addDays, todayInZone } from '@/lib/public-booking/client-dates';
import type { PublicApiError, PublicShop } from '@/lib/public-booking/types';
import { TIME_OF_DAY_PRESETS, WEEKDAY_LABELS, buildWindows } from '@/lib/waitlist/types';
import { cn } from '@/lib/utils';

const DEFAULT_RANGE_DAYS = 14;

export interface WaitlistFormProps {
	shop: PublicShop;
	serviceId: string | null;
	staffChoice: string;
	onJoined: () => void;
}

export function WaitlistForm({ shop, serviceId, staffChoice, onJoined }: WaitlistFormProps) {
	const [today] = useState(() => todayInZone(shop.timezone));
	const [service, setService] = useState(serviceId ?? shop.services[0]?.id ?? '');
	const [staff, setStaff] = useState(staffChoice);
	const [earliest, setEarliest] = useState(today);
	const [latest, setLatest] = useState(() => addDays(today, DEFAULT_RANGE_DAYS));
	const [weekdays, setWeekdays] = useState<number[]>([]);
	const [times, setTimes] = useState<string[]>([]);
	const [name, setName] = useState('');
	const [phone, setPhone] = useState('');
	const [consent, setConsent] = useState(false);
	const [website, setWebsite] = useState('');
	const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
	const [apiError, setApiError] = useState<PublicApiError | null>(null);
	const [submitting, setSubmitting] = useState(false);
	const errorRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (apiError) errorRef.current?.focus();
	}, [apiError]);

	const toggle = <T,>(list: T[], value: T) =>
		list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

	function validate(): Record<string, string> {
		const errors: Record<string, string> = {};
		if (!service) errors.serviceId = 'Choose a service.';
		if (!name.trim()) errors.name = 'Enter your name.';
		if (!phone.trim()) errors.phone = 'Enter your mobile number.';
		if (!earliest) errors.earliestDate = 'Choose a first date.';
		if (!latest) errors.latestDate = 'Choose a last date.';
		else if (earliest && latest < earliest) {
			errors.latestDate = 'The last date must not be before the first date.';
		}
		if (!consent) errors.offersRequested = 'Tick the box to join the waitlist.';
		return errors;
	}

	async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (submitting) return;
		const errors = validate();
		setFieldErrors(errors);
		setApiError(null);
		const first = Object.keys(errors)[0];
		if (first) {
			document.getElementById(`waitlist-${first}`)?.focus();
			return;
		}

		setSubmitting(true);
		const result = await joinWaitlist(shop.slug, {
			serviceId: service,
			staffId: staff,
			earliestDate: earliest,
			latestDate: latest,
			timeWindows: buildWindows(weekdays, times),
			name,
			phone,
			offersRequested: consent,
			website,
		});
		setSubmitting(false);

		if (result.ok) {
			onJoined();
			return;
		}
		if (result.error.error === 'invalid_request' && result.error.fieldErrors) {
			setFieldErrors(result.error.fieldErrors);
		}
		setApiError(result.error);
	}

	return (
		<form onSubmit={onSubmit} noValidate className="grid gap-4">
			<p className="text-sm text-muted-foreground">
				Tell us what you&apos;re after. When a spot opens up we&apos;ll text you, and the first
				person to tap the link gets it.
			</p>
			<div ref={errorRef} tabIndex={-1} className="outline-none">
				<FormError message={apiError?.message} />
			</div>

			<FieldShell id="waitlist-serviceId" label="Service" error={fieldErrors.serviceId}>
				<select
					id="waitlist-serviceId"
					className={cn(nativeControlClass, 'h-11')}
					value={service}
					onChange={(e) => setService(e.target.value)}
					{...describedBy('waitlist-serviceId', fieldErrors.serviceId)}
				>
					{shop.services.map((s) => (
						<option key={s.id} value={s.id}>
							{s.name}
						</option>
					))}
				</select>
			</FieldShell>

			{shop.staff.length > 1 ? (
				<FieldShell id="waitlist-staffId" label="Stylist">
					<select
						id="waitlist-staffId"
						className={cn(nativeControlClass, 'h-11')}
						value={staff}
						onChange={(e) => setStaff(e.target.value)}
					>
						<option value="any">Anyone</option>
						{shop.staff.map((s) => (
							<option key={s.id} value={s.id}>
								{s.displayName}
							</option>
						))}
					</select>
				</FieldShell>
			) : null}

			<div className="grid grid-cols-2 gap-3">
				<FieldShell id="waitlist-earliestDate" label="From" error={fieldErrors.earliestDate}>
					<Input
						id="waitlist-earliestDate"
						type="date"
						className="h-11"
						min={today}
						value={earliest}
						onChange={(e) => setEarliest(e.target.value)}
						{...describedBy('waitlist-earliestDate', fieldErrors.earliestDate)}
					/>
				</FieldShell>
				<FieldShell id="waitlist-latestDate" label="Until" error={fieldErrors.latestDate}>
					<Input
						id="waitlist-latestDate"
						type="date"
						className="h-11"
						min={earliest || today}
						value={latest}
						onChange={(e) => setLatest(e.target.value)}
						{...describedBy('waitlist-latestDate', fieldErrors.latestDate)}
					/>
				</FieldShell>
			</div>

			<fieldset className="grid gap-2">
				<legend className="mb-1 text-sm font-medium">Days (optional)</legend>
				<div className="flex flex-wrap gap-2">
					{WEEKDAY_LABELS.map((label, weekday) => (
						<Chip
							key={label}
							label={label.slice(0, 3)}
							checked={weekdays.includes(weekday)}
							onChange={() => setWeekdays((list) => toggle(list, weekday))}
						/>
					))}
				</div>
			</fieldset>

			<fieldset className="grid gap-2">
				<legend className="mb-1 text-sm font-medium">Time of day (optional)</legend>
				<div className="flex flex-wrap gap-2">
					{TIME_OF_DAY_PRESETS.map((preset) => (
						<Chip
							key={preset.id}
							label={preset.label}
							checked={times.includes(preset.id)}
							onChange={() => setTimes((list) => toggle(list, preset.id))}
						/>
					))}
				</div>
				<p className="text-xs text-muted-foreground">Leave both empty for any day and time.</p>
			</fieldset>

			<FieldShell id="waitlist-name" label="Name" error={fieldErrors.name}>
				<Input
					id="waitlist-name"
					name="name"
					autoComplete="name"
					className="h-11"
					maxLength={80}
					value={name}
					onChange={(e) => setName(e.target.value)}
					{...describedBy('waitlist-name', fieldErrors.name)}
				/>
			</FieldShell>

			<FieldShell id="waitlist-phone" label="Mobile number" error={fieldErrors.phone}>
				<Input
					id="waitlist-phone"
					name="phone"
					type="tel"
					inputMode="tel"
					autoComplete="tel"
					className="h-11"
					value={phone}
					onChange={(e) => setPhone(e.target.value)}
					{...describedBy('waitlist-phone', fieldErrors.phone)}
				/>
			</FieldShell>

			<div className="grid gap-1">
				<label className="flex items-start gap-3 text-sm">
					<input
						id="waitlist-offersRequested"
						type="checkbox"
						className="mt-0.5 size-5 shrink-0 accent-primary"
						checked={consent}
						onChange={(e) => setConsent(e.target.checked)}
						{...describedBy('waitlist-offersRequested', fieldErrors.offersRequested)}
					/>
					<span>
						<span className="font-medium">Text me when a spot opens</span>
						<span className="block text-muted-foreground">
							{shop.name} will text you about spots that match. Reply STOP anytime to stop.
						</span>
					</span>
				</label>
				{fieldErrors.offersRequested ? (
					<p id="waitlist-offersRequested-error" className="text-sm text-destructive">
						{fieldErrors.offersRequested}
					</p>
				) : null}
			</div>

			{/* Honeypot: off-screen and skipped by keyboard and screen readers; bots fill it in. */}
			<div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
				<label htmlFor="waitlist-website">Website</label>
				<input
					id="waitlist-website"
					name="website"
					tabIndex={-1}
					autoComplete="off"
					value={website}
					onChange={(e) => setWebsite(e.target.value)}
				/>
			</div>

			<Button type="submit" size="lg" className="h-12 text-base" disabled={submitting}>
				{submitting ? 'Joining…' : 'Join the waitlist'}
			</Button>
		</form>
	);
}

function Chip({
	label,
	checked,
	onChange,
}: {
	label: string;
	checked: boolean;
	onChange: () => void;
}) {
	return (
		<label
			className={cn(
				'flex min-h-11 cursor-pointer items-center rounded-full border px-4 text-sm font-medium has-focus-visible:ring-3 has-focus-visible:ring-ring/50',
				checked
					? 'border-primary bg-primary text-primary-foreground'
					: 'bg-background hover:bg-muted',
			)}
		>
			<input type="checkbox" checked={checked} onChange={onChange} className="sr-only" />
			{label}
		</label>
	);
}
