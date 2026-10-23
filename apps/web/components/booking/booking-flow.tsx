'use client';

import { ArrowLeft, Check, ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { StepProgress } from '@/components/layout/step-progress';
import { Button } from '@/components/ui/button';
import { formatCents } from '@/lib/money/format';
import type { BookingCreated, PublicShop, PublicSlot } from '@/lib/public-booking/types';
import { AddToCalendarButton } from './add-to-calendar';
import { BookingSummary } from './booking-summary';
import { DetailsForm } from './details-form';
import { TimePicker } from './time-picker';
import { WaitlistForm } from './waitlist-form';

type Step = 'service' | 'time' | 'details' | 'done' | 'waitlist' | 'waitlisted';

const STEP_TITLES: Record<Step, string> = {
	service: 'Choose a service',
	time: 'Pick a time',
	details: 'Your details',
	done: "You're booked",
	waitlist: 'Join the waitlist',
	waitlisted: "You're on the waitlist",
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

	const backLabel =
		step === 'details'
			? 'Change time'
			: step === 'waitlist'
				? 'Back to times'
				: step === 'time'
					? 'Change service'
					: null;

	return (
		<section aria-labelledby="booking-step-title" className="grid gap-5">
			<div className="sticky top-0 z-20 -mx-4 grid gap-3 border-b bg-background/95 px-4 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-3 backdrop-blur supports-backdrop-filter:bg-background/80 md:static md:mx-0 md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
				{stepNumber ? <StepProgress current={stepNumber} total={3} /> : null}
				<div className="flex items-center justify-between gap-2">
					<h2
						id="booking-step-title"
						ref={headingRef}
						tabIndex={-1}
						className="flex items-center gap-2 text-xl font-semibold tracking-tight outline-none"
					>
						{step === 'done' || step === 'waitlisted' ? (
							<span className="flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground">
								<Check aria-hidden className="size-4" />
							</span>
						) : null}
						{STEP_TITLES[step]}
					</h2>
					{backLabel ? (
						<Button
							type="button"
							variant="ghost"
							className="h-10 shrink-0 px-2 text-muted-foreground"
							onClick={() =>
								setStep(step === 'details' || step === 'waitlist' ? 'time' : 'service')
							}
						>
							<ArrowLeft aria-hidden />
							{backLabel}
						</Button>
					) : null}
				</div>
			</div>

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
									className="flex min-h-16 w-full items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 text-left outline-none hover:border-primary/40 hover:bg-primary/5 focus-visible:ring-3 focus-visible:ring-ring/50"
								>
									<span className="grid">
										<span className="font-medium">{s.name}</span>
										<span className="text-sm text-muted-foreground">{s.durationMinutes} min</span>
									</span>
									<span className="flex items-center gap-2 font-semibold">
										{formatCents(s.priceCents, shop.currency)}
										<ChevronRight aria-hidden className="size-4 text-muted-foreground" />
									</span>
								</button>
							</li>
						))}
					</ul>
				)
			) : null}

			{step === 'time' && service ? (
				<>
					<p className="rounded-lg bg-muted/60 px-3 py-2 text-sm">
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
					{shop.waitlistEnabled ? (
						<div className="grid gap-1 rounded-lg border bg-muted/40 p-3">
							<p className="text-sm font-medium">Can&apos;t find a time?</p>
							<Button
								type="button"
								variant="outline"
								className="h-11 justify-self-start"
								onClick={() => setStep('waitlist')}
							>
								Join the waitlist
							</Button>
						</div>
					) : null}
				</>
			) : null}

			{step === 'waitlist' ? (
				<WaitlistForm
					shop={shop}
					serviceId={serviceId}
					staffChoice={staffChoice}
					onJoined={() => setStep('waitlisted')}
				/>
			) : null}

			{step === 'waitlisted' ? (
				<div className="grid gap-3">
					<p className="text-sm">
						We&apos;ll text you when a spot opens that matches. The first person to tap the link
						gets it. A confirmation text with a link to leave the waitlist is on its way.
					</p>
					<Button type="button" variant="link" className="justify-self-start px-0" onClick={reset}>
						Back to booking
					</Button>
				</div>
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
					<div className="grid gap-2 sm:flex sm:flex-wrap">
						<AddToCalendarButton
							booking={created.booking}
							reference={created.reference}
							manageUrl={created.manageUrl}
						/>
						<a
							href={created.manageUrl}
							className="inline-flex h-11 items-center justify-center rounded-lg border px-4 text-sm font-medium outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50"
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
