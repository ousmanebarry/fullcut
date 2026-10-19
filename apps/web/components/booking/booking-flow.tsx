'use client';

import { ArrowLeft, Check } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { formatCents } from '@/lib/money/format';
import type { BookingCreated, PublicShop, PublicSlot } from '@/lib/public-booking/types';
import { AddToCalendarButton } from './add-to-calendar';
import { BookingSummary } from './booking-summary';
import { DetailsForm } from './details-form';
import { TimePicker } from './time-picker';

type Step = 'service' | 'time' | 'details' | 'done';

const STEP_TITLES: Record<Step, string> = {
	service: 'Choose a service',
	time: 'Pick a time',
	details: 'Your details',
	done: "You're booked",
};
const STEP_NUMBER: Partial<Record<Step, number>> = { service: 1, time: 2, details: 3 };

export function BookingFlow({ shop }: { shop: PublicShop }) {
	const [step, setStep] = useState<Step>('service');
	const [serviceId, setServiceId] = useState<string | null>(null);
	const [staffChoice, setStaffChoice] = useState('any');
	const [slot, setSlot] = useState<PublicSlot | null>(null);
	const [created, setCreated] = useState<BookingCreated | null>(null);
	const headingRef = useRef<HTMLHeadingElement>(null);
	const moved = useRef(false);

	// Move focus to the new step's heading so keyboard and screen-reader users follow along.
	useEffect(() => {
		if (moved.current) headingRef.current?.focus();
		moved.current = true;
	}, [step]);

	const service = shop.services.find((s) => s.id === serviceId) ?? null;
	const staffName = (id: string) => shop.staff.find((s) => s.id === id)?.displayName ?? '';
	const stepNumber = STEP_NUMBER[step];

	function reset() {
		setServiceId(null);
		setSlot(null);
		setCreated(null);
		setStep('service');
	}

	return (
		<section aria-labelledby="booking-step-title" className="grid gap-4">
			<div className="grid gap-1">
				{stepNumber ? (
					<p className="text-xs font-medium text-muted-foreground">Step {stepNumber} of 3</p>
				) : null}
				<h2
					id="booking-step-title"
					ref={headingRef}
					tabIndex={-1}
					className="flex items-center gap-2 text-xl font-semibold outline-none"
				>
					{step === 'done' ? <Check aria-hidden className="size-5" /> : null}
					{STEP_TITLES[step]}
				</h2>
			</div>

			{step !== 'service' && step !== 'done' ? (
				<Button
					type="button"
					variant="ghost"
					className="h-11 justify-self-start px-2"
					onClick={() => setStep(step === 'details' ? 'time' : 'service')}
				>
					<ArrowLeft aria-hidden />
					{step === 'details' ? 'Change time' : 'Change service'}
				</Button>
			) : null}

			{step === 'service' ? (
				shop.services.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						This shop isn&apos;t taking online bookings for any services yet.
					</p>
				) : (
					<ul className="grid gap-2">
						{shop.services.map((s) => (
							<li key={s.id}>
								<button
									type="button"
									onClick={() => {
										setServiceId(s.id);
										setSlot(null);
										setStep('time');
									}}
									className="flex min-h-16 w-full items-center justify-between gap-3 rounded-xl border bg-background px-4 py-3 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
								>
									<span className="grid">
										<span className="font-medium">{s.name}</span>
										<span className="text-sm text-muted-foreground">{s.durationMinutes} min</span>
									</span>
									<span className="font-medium">{formatCents(s.priceCents, shop.currency)}</span>
								</button>
							</li>
						))}
					</ul>
				)
			) : null}

			{step === 'time' && service ? (
				<>
					<p className="text-sm">
						<span className="font-medium">{service.name}</span>
						<span className="text-muted-foreground">
							{' '}
							· {service.durationMinutes} min · {formatCents(service.priceCents, shop.currency)}
						</span>
					</p>
					<TimePicker
						slug={shop.slug}
						timezone={shop.timezone}
						serviceId={service.id}
						staff={shop.staff}
						staffChoice={staffChoice}
						onStaffChoiceChange={(choice) => {
							setStaffChoice(choice);
							setSlot(null);
						}}
						selected={slot}
						onPick={(picked) => {
							setSlot(picked);
							setStep('details');
						}}
					/>
				</>
			) : null}

			{step === 'details' && service && slot ? (
				<DetailsForm
					shop={shop}
					serviceId={service.id}
					staffChoice={staffChoice}
					slot={slot}
					summary={{
						serviceName: service.name,
						staffName: staffName(slot.staffId),
						when: slot.label,
						durationMinutes: service.durationMinutes,
						priceCents: service.priceCents,
						currency: shop.currency,
					}}
					onSlotChange={setSlot}
					onBooked={(result) => {
						setCreated(result);
						setStep('done');
					}}
				/>
			) : null}

			{step === 'done' && created ? (
				<div className="grid gap-4">
					<p className="text-sm">
						See you soon! Your booking reference is{' '}
						<span className="font-mono font-semibold">{created.reference}</span>.
					</p>
					<div className="rounded-lg border bg-muted/40 p-3">
						<BookingSummary
							item={{
								serviceName: created.booking.serviceName,
								staffName: created.booking.staffName,
								when: created.booking.label,
								durationMinutes: created.booking.durationMinutes,
								priceCents: created.booking.priceCents,
								currency: created.booking.currency,
							}}
						/>
					</div>
					<div className="flex flex-wrap gap-2">
						<AddToCalendarButton
							booking={created.booking}
							reference={created.reference}
							manageUrl={created.manageUrl}
						/>
						<a
							href={created.manageUrl}
							className="inline-flex h-11 items-center rounded-lg border px-3 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
						>
							Manage booking
						</a>
					</div>
					<p className="text-sm text-muted-foreground">
						Save the manage link to view, reschedule or cancel later — no account needed.
					</p>
					<Button type="button" variant="link" className="justify-self-start px-0" onClick={reset}>
						Book another appointment
					</Button>
				</div>
			) : null}
		</section>
	);
}
