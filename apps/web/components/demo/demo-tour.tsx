'use client';

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';

const STORAGE_KEY = 'fullcut.demo-tour.done';
const HIGHLIGHT = ['ring-2', 'ring-primary', 'ring-offset-2'];

const STEPS = [
	{
		href: '/dashboard/calendar',
		title: 'No-show risk',
		body: 'In the calendar, a red or amber dot marks a booking with a high or medium no-show risk. Open one to see why it was flagged and whether the client confirmed.',
	},
	{
		href: '/dashboard/settings',
		title: 'You decide what happens',
		body: 'Settings → No-show protection sets what each risk level triggers: a confirmation request, an extra reminder, a standby from your waitlist, or releasing the slot if the client doesn’t confirm. Every action can be turned off.',
	},
	{
		href: '/dashboard/waitlist',
		title: 'Waitlist refill',
		body: 'Clients waiting for a slot. When a booking is cancelled, matching clients get a text and the first to tap books it.',
	},
	{
		href: '/dashboard',
		title: 'Today',
		body: 'Your appointments, past bookings that still need an outcome, and how many cancelled slots the waitlist refilled.',
	},
] as const;

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
	listeners.add(listener);
	window.addEventListener('storage', listener);
	return () => {
		listeners.delete(listener);
		window.removeEventListener('storage', listener);
	};
}

const isDone = () => window.localStorage.getItem(STORAGE_KEY) === '1';

function setDone(done: boolean) {
	if (done) window.localStorage.setItem(STORAGE_KEY, '1');
	else window.localStorage.removeItem(STORAGE_KEY);
	for (const listener of listeners) listener();
}

// Phones and desktop each render a Main nav; only one is visible.
const findTarget = (href: string) =>
	Array.from(
		document.querySelectorAll<HTMLElement>(`nav[aria-label="Main"] a[href="${href}"]`),
	).find((el) => el.getClientRects().length > 0);

/** A four-step tour of the demo dashboard, anchored to the main navigation. */
export function DemoTour() {
	// Server render and first paint assume "done", so the tour never flashes before hydration.
	const done = useSyncExternalStore(subscribe, isDone, () => true);
	const [step, setStep] = useState(0);
	const popover = useRef<HTMLDivElement>(null);
	const heading = useRef<HTMLHeadingElement>(null);
	const current = STEPS[step] ?? STEPS[0];
	const last = step === STEPS.length - 1;

	useLayoutEffect(() => {
		if (done) return;
		const target = findTarget(current.href);
		target?.classList.add(...HIGHLIGHT);
		const place = () => {
			const el = popover.current;
			if (!el) return;
			const margin = 8;
			const rect = target?.getBoundingClientRect();
			const below = rect ? rect.bottom + margin : window.innerHeight / 3;
			const top =
				rect && below + el.offsetHeight > window.innerHeight
					? rect.top - margin - el.offsetHeight
					: below;
			const centre = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
			const left = Math.min(
				Math.max(centre - el.offsetWidth / 2, margin),
				window.innerWidth - el.offsetWidth - margin,
			);
			el.style.top = `${top}px`;
			el.style.left = `${left}px`;
		};
		place();
		window.addEventListener('resize', place);
		window.addEventListener('scroll', place, { passive: true });
		return () => {
			target?.classList.remove(...HIGHLIGHT);
			window.removeEventListener('resize', place);
			window.removeEventListener('scroll', place);
		};
	}, [done, current.href]);

	useEffect(() => {
		if (!done) heading.current?.focus();
	}, [done, step]);

	if (done) return null;

	const finish = () => {
		setStep(0);
		setDone(true);
	};

	return (
		<div
			ref={popover}
			role="dialog"
			aria-labelledby="demo-tour-title"
			aria-describedby="demo-tour-body"
			onKeyDown={(event) => {
				if (event.key === 'Escape') finish();
			}}
			className="fixed z-50 grid w-80 max-w-[calc(100vw-1rem)] gap-3 rounded-lg border bg-background p-4 text-sm shadow-lg"
		>
			<div className="grid gap-1">
				<p className="text-xs text-muted-foreground">
					Tour · {step + 1} of {STEPS.length}
				</p>
				<h2 id="demo-tour-title" ref={heading} tabIndex={-1} className="font-medium outline-none">
					{current.title}
				</h2>
				<p id="demo-tour-body" className="text-muted-foreground">
					{current.body}
				</p>
			</div>
			<div className="flex items-center gap-2">
				<Button type="button" variant="ghost" size="sm" onClick={finish}>
					Skip tour
				</Button>
				<div className="ml-auto flex gap-2">
					{step > 0 ? (
						<Button type="button" variant="outline" size="sm" onClick={() => setStep(step - 1)}>
							Back
						</Button>
					) : null}
					<Button type="button" size="sm" onClick={last ? finish : () => setStep(step + 1)}>
						{last ? 'Done' : 'Next'}
					</Button>
				</div>
			</div>
		</div>
	);
}

export function RestartTourButton() {
	return (
		<button
			type="button"
			onClick={() => setDone(false)}
			className="font-medium underline underline-offset-4 hover:no-underline"
		>
			Take the tour
		</button>
	);
}
