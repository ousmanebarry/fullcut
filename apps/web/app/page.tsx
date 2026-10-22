import {
	CalendarCheckIcon,
	DownloadIcon,
	MessageSquareTextIcon,
	ShieldCheckIcon,
	SmartphoneIcon,
} from 'lucide-react';
import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { Logo } from '@/components/brand/logo';
import { DemoEntry } from '@/components/demo/demo-entry';
import { ThemeToggle } from '@/components/theme/theme-toggle';
import { buttonVariants } from '@/components/ui/button';
import { getDemoShopSlug } from '@/lib/env';
import { cn } from '@/lib/utils';

export const metadata: Metadata = {
	title: { absolute: 'Fullcut · Booking for independent barbers and stylists' },
};

const FEATURES = [
	{
		id: 'no-shows',
		title: 'Spots no-shows before they happen',
		body: 'Every upcoming booking gets a low, medium or high no-show risk, based on the client’s own history with you and how far ahead they booked. Risky bookings can get a confirmation text, and unconfirmed ones can be released so someone else can book. Nothing happens until you turn it on, and you can trust any client with one tap.',
		image: {
			src: '/screenshots/no-show-risk.png',
			width: 1280,
			height: 800,
			alt: 'A booking in the Fullcut calendar marked high risk and unconfirmed, with the reasons: 11 no-shows in the last 23 visits, 3 late cancellations, missed their last appointment.',
		},
	},
	{
		id: 'waitlist',
		title: 'Refills cancelled slots for you',
		body: 'When a booking is cancelled or moved, clients waiting for that service and time get a text. The first to tap books the slot. No group chats, no calling down a list.',
		image: {
			src: '/screenshots/waitlist.png',
			width: 1280,
			height: 800,
			alt: 'The Fullcut waitlist: three clients waiting, each with a service, a date range and preferred times.',
		},
	},
	{
		id: 'booking-page',
		title: 'Your booking page, not a marketplace',
		body: 'Clients pick a service, a time and confirm: three steps, no account, no app to download. No competitors listed next to you, no commission and no new-client fee. The clients who book are yours.',
		image: {
			src: '/screenshots/booking-page.png',
			width: 1082,
			height: 2202,
			alt: 'A shop’s booking page on a phone, showing open times for a haircut.',
		},
		phone: true,
	},
] as const;

const BASICS = [
	{
		icon: CalendarCheckIcon,
		title: 'No double bookings',
		body: 'Overlaps are rejected by the database itself, even when two clients tap the same time at once.',
	},
	{
		icon: MessageSquareTextIcon,
		title: 'Texts that behave',
		body: 'Confirmations and reminders by SMS, sent outside quiet hours, and STOP is honoured immediately.',
	},
	{
		icon: DownloadIcon,
		title: 'Your data, always',
		body: 'Export your clients, services and bookings as CSV whenever you like.',
	},
	{
		icon: SmartphoneIcon,
		title: 'On your phone',
		body: 'Install the dashboard as an app on iPhone, iPad or Android.',
	},
] as const;

export default function Home() {
	const demoShopSlug = getDemoShopSlug();
	return (
		<div className="flex flex-1 flex-col">
			<header className="sticky top-0 z-30 border-b bg-background/90 pt-safe backdrop-blur supports-backdrop-filter:bg-background/75">
				<div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-2 px-4">
					<Logo />
					<nav aria-label="Main" className="ml-auto flex items-center gap-1">
						<ThemeToggle />
						<Link
							href="#pricing"
							className="hidden rounded-md px-2.5 py-1.5 text-sm hover:bg-accent sm:block"
						>
							Pricing
						</Link>
						<Link href="/login" className="rounded-md px-2.5 py-1.5 text-sm hover:bg-accent">
							Log in
						</Link>
						<Link href="/signup" className={buttonVariants()}>
							Sign up
						</Link>
					</nav>
				</div>
			</header>

			<main className="flex-1">
				<section
					className={cn(
						'mx-auto grid w-full max-w-6xl gap-10 px-4 py-12 md:items-center md:py-24',
						demoShopSlug && 'md:grid-cols-[1.2fr_1fr]',
					)}
				>
					<div className="grid gap-5">
						<p className="w-fit rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary">
							Zero commission, ever
						</p>
						<h1 className="font-heading text-4xl font-semibold tracking-tight text-balance md:text-6xl">
							Fill your chair. Keep your clients.
						</h1>
						<p className="text-lg text-pretty text-muted-foreground">
							Booking for independent barbers and stylists who already have their own clients. Flat
							price, zero commission, and an app that works to fill the gaps in your day.
						</p>
						<div className="grid gap-2 sm:flex sm:flex-wrap">
							<Link href="/signup" className={cn(buttonVariants({ size: 'lg' }), 'h-11 px-5')}>
								Set up your shop free
							</Link>
							<Link
								href="#features"
								className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'h-11 px-5')}
							>
								See how it works
							</Link>
						</div>
					</div>
					{demoShopSlug ? <DemoEntry shopSlug={demoShopSlug} /> : null}
				</section>

				<section
					id="features"
					aria-labelledby="features-heading"
					className="border-t bg-muted/40 py-16 md:py-24"
				>
					<div className="mx-auto grid w-full max-w-6xl gap-16 px-4">
						<h2
							id="features-heading"
							className="text-center text-3xl font-semibold tracking-tight text-balance"
						>
							Built to keep your chair full
						</h2>
						{FEATURES.map((feature, i) => (
							<article
								key={feature.id}
								aria-labelledby={`${feature.id}-heading`}
								className="grid items-center gap-8 md:grid-cols-2"
							>
								<div className={i % 2 === 1 ? 'grid gap-3 md:order-2' : 'grid gap-3'}>
									<h3 id={`${feature.id}-heading`} className="text-2xl font-semibold">
										{feature.title}
									</h3>
									<p className="text-pretty text-muted-foreground">{feature.body}</p>
								</div>
								<Image
									src={feature.image.src}
									width={feature.image.width}
									height={feature.image.height}
									alt={feature.image.alt}
									sizes={
										'phone' in feature
											? '(min-width: 768px) 280px, 70vw'
											: '(min-width: 768px) 560px, 100vw'
									}
									className={
										'phone' in feature
											? 'mx-auto w-full max-w-70 rounded-3xl border-4 border-foreground/80 shadow-lg'
											: 'w-full rounded-xl border shadow-lg'
									}
								/>
							</article>
						))}
					</div>
				</section>

				<section aria-labelledby="basics-heading" className="mx-auto w-full max-w-6xl px-4 py-16">
					<h2 id="basics-heading" className="sr-only">
						The basics, done properly
					</h2>
					<ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
						{BASICS.map(({ icon: Icon, title, body }) => (
							<li key={title} className="grid content-start gap-2">
								<span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
									<Icon aria-hidden="true" className="size-5" />
								</span>
								<h3 className="font-medium">{title}</h3>
								<p className="text-sm text-muted-foreground">{body}</p>
							</li>
						))}
					</ul>
				</section>

				<section id="pricing" aria-labelledby="pricing-heading" className="border-t py-16 md:py-24">
					<div className="mx-auto grid w-full max-w-2xl gap-4 px-4 text-center">
						<h2 id="pricing-heading" className="text-3xl font-semibold tracking-tight">
							Free during the beta
						</h2>
						<p className="text-pretty text-muted-foreground">
							Fullcut is free while it’s in beta. After that it will be one flat monthly price,
							shown to you before you pay anything.
						</p>
						<ul className="mx-auto grid gap-2 text-left text-sm">
							{[
								'Never a commission on your clients',
								'Never a fee for new clients',
								'No add-ons hiding the real price',
								'Export everything and leave whenever you want',
							].map((line) => (
								<li key={line} className="flex items-center gap-2">
									<ShieldCheckIcon aria-hidden="true" className="size-4 shrink-0 text-primary" />
									{line}
								</li>
							))}
						</ul>
						<div className="grid sm:block">
							<Link href="/signup" className={cn(buttonVariants({ size: 'lg' }), 'h-11 px-5')}>
								Set up your shop free
							</Link>
						</div>
					</div>
				</section>

				<section aria-labelledby="roadmap-heading" className="border-t bg-muted/40 py-12">
					<div className="mx-auto grid w-full max-w-2xl gap-2 px-4 text-center">
						<h2 id="roadmap-heading" className="font-medium">
							Coming next
						</h2>
						<p className="text-sm text-pretty text-muted-foreground">
							“Who’s due” reminders for clients past their usual visit, booking source reports,
							imports from Square, Booksy, Fresha and Vagaro, and slot suggestions that learn how
							long each stylist really takes.
						</p>
					</div>
				</section>
			</main>

			<footer className="border-t">
				<div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-4 px-4 py-6 text-sm text-muted-foreground">
					<Logo className="text-foreground" />
					<Link href="/login" className="hover:underline">
						Log in
					</Link>
					<Link href="/signup" className="hover:underline">
						Sign up
					</Link>
				</div>
			</footer>
		</div>
	);
}
