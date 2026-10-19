'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { fetchAvailability } from '@/lib/public-booking/client-api';
import {
	addDays,
	browserTimeZone,
	longDateLabel,
	todayInZone,
	zoneDisplayName,
} from '@/lib/public-booking/client-dates';
import type {
	AvailabilityResponse,
	DayPeriod,
	PublicSlot,
	PublicStaff,
} from '@/lib/public-booking/types';
import { cn } from '@/lib/utils';

const WINDOW_DAYS = 7;
const PERIODS: { id: DayPeriod; label: string }[] = [
	{ id: 'morning', label: 'Morning' },
	{ id: 'afternoon', label: 'Afternoon' },
	{ id: 'evening', label: 'Evening' },
];

export interface TimePickerProps {
	slug: string;
	timezone: string;
	serviceId: string;
	staff: readonly PublicStaff[];
	staffChoice: string;
	onStaffChoiceChange: (staffChoice: string) => void;
	selected: PublicSlot | null;
	onPick: (slot: PublicSlot) => void;
	idPrefix?: string;
}

type Loaded = { key: string } & (
	{ ok: true; data: AvailabilityResponse } | { ok: false; message: string }
);

const noopSubscribe = () => () => {};

export function TimePicker({
	slug,
	timezone,
	serviceId,
	staff,
	staffChoice,
	onStaffChoiceChange,
	selected,
	onPick,
	idPrefix = 'time',
}: TimePickerProps) {
	const [today] = useState(() => todayInZone(timezone));
	const [windowStart, setWindowStart] = useState(today);
	const [userDate, setUserDate] = useState<string | null>(null);
	const [loaded, setLoaded] = useState<Loaded | null>(null);
	const [retry, setRetry] = useState(0);
	const browserTz = useSyncExternalStore(noopSubscribe, browserTimeZone, () => null);

	const windowEnd = addDays(windowStart, WINDOW_DAYS - 1);
	const key = `${serviceId}|${staffChoice}|${windowStart}|${retry}`;

	useEffect(() => {
		const controller = new AbortController();
		fetchAvailability(
			slug,
			{ serviceId, staffId: staffChoice, from: windowStart, to: windowEnd },
			controller.signal,
		)
			.then((result) =>
				setLoaded(
					result.ok
						? { key, ok: true, data: result.data }
						: { key, ok: false, message: result.error.message },
				),
			)
			.catch(() => {
				// Aborted because the inputs changed; the next request takes over.
			});
		return () => controller.abort();
	}, [slug, serviceId, staffChoice, windowStart, windowEnd, key]);

	const current = loaded?.key === key ? loaded : null;
	const data = current?.ok ? current.data : null;
	const loading = current === null;

	const days = useMemo(
		() =>
			data?.days.map((d) => d.date) ??
			Array.from({ length: WINDOW_DAYS }, (_, i) => addDays(windowStart, i)),
		[data, windowStart],
	);
	const slotsByDate = useMemo(() => {
		const map = new Map<string, PublicSlot[]>();
		for (const slot of data?.slots ?? []) map.set(slot.date, [...(map.get(slot.date) ?? []), slot]);
		return map;
	}, [data]);

	const activeDate =
		userDate && userDate >= windowStart && userDate <= windowEnd
			? userDate
			: (days.find((d) => slotsByDate.has(d)) ?? windowStart);
	const daySlots = slotsByDate.get(activeDate) ?? [];
	const laterOpenDay = days.find((d) => d > activeDate && slotsByDate.has(d));
	const weekIsEmpty = data !== null && data.slots.length === 0;

	function moveWindow(start: string, date: string | null = null) {
		setWindowStart(start < today ? today : start);
		setUserDate(date);
	}

	function jumpToNextOpenDay() {
		if (laterOpenDay) setUserDate(laterOpenDay);
		else moveWindow(addDays(windowStart, WINDOW_DAYS));
	}

	const dayInfo = (date: string) => data?.days.find((d) => d.date === date);

	return (
		<div className="grid gap-5">
			{staff.length > 1 ? (
				<fieldset className="grid gap-2">
					<legend className="mb-2 text-sm font-medium">Stylist</legend>
					<div className="flex flex-wrap gap-2">
						{[{ id: 'any', displayName: 'Anyone' }, ...staff].map((s) => (
							<label
								key={s.id}
								className={cn(
									'flex min-h-11 cursor-pointer items-center rounded-full border px-4 text-sm font-medium has-focus-visible:ring-3 has-focus-visible:ring-ring/50',
									staffChoice === s.id
										? 'border-primary bg-primary text-primary-foreground'
										: 'bg-background hover:bg-muted',
								)}
							>
								<input
									type="radio"
									name={`${idPrefix}-staff`}
									value={s.id}
									checked={staffChoice === s.id}
									onChange={() => onStaffChoiceChange(s.id)}
									className="sr-only"
								/>
								{s.displayName}
							</label>
						))}
					</div>
				</fieldset>
			) : null}

			<div className="flex flex-wrap items-center justify-between gap-2">
				<h3 className="text-sm font-medium">{longDateLabel(activeDate)}</h3>
				<Button
					type="button"
					variant="outline"
					size="lg"
					className="min-h-11"
					onClick={() => {
						if (windowStart === today) {
							const first = days.find((d) => slotsByDate.has(d));
							if (first) setUserDate(first);
							else if (data?.nextOpenDate) moveWindow(data.nextOpenDate, data.nextOpenDate);
						} else {
							moveWindow(today);
						}
					}}
				>
					Next available
				</Button>
			</div>

			<div className="flex items-stretch gap-1">
				<Button
					type="button"
					variant="ghost"
					size="icon-lg"
					className="h-auto min-h-11 shrink-0"
					aria-label="Previous week"
					disabled={windowStart <= today}
					onClick={() => moveWindow(addDays(windowStart, -WINDOW_DAYS))}
				>
					<ChevronLeft aria-hidden />
				</Button>
				<ul className="grid flex-1 grid-cols-7 gap-1" aria-label="Choose a day">
					{days.map((date) => {
						const info = dayInfo(date);
						const count = slotsByDate.get(date)?.length ?? 0;
						const active = date === activeDate;
						return (
							<li key={date}>
								<button
									type="button"
									aria-pressed={active}
									onClick={() => setUserDate(date)}
									className={cn(
										'flex min-h-14 w-full flex-col items-center justify-center rounded-lg border text-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
										active
											? 'border-primary bg-primary text-primary-foreground'
											: 'bg-background hover:bg-muted',
										!loading && count === 0 && !active && 'text-muted-foreground',
									)}
								>
									<span>{info?.weekday ?? weekdayShort(date)}</span>{' '}
									<span className="text-base font-semibold">{Number(date.slice(8))}</span>
									<span className="sr-only">
										{` ${monthLong(date)}, ${loading ? 'loading' : count === 0 ? 'no times' : `${count} times`}`}
									</span>
									<span
										aria-hidden
										className={cn(
											'mt-0.5 size-1.5 rounded-full',
											count > 0
												? active
													? 'bg-primary-foreground'
													: 'bg-primary'
												: 'bg-transparent',
										)}
									/>
								</button>
							</li>
						);
					})}
				</ul>
				<Button
					type="button"
					variant="ghost"
					size="icon-lg"
					className="h-auto min-h-11 shrink-0"
					aria-label="Next week"
					onClick={() => moveWindow(addDays(windowStart, WINDOW_DAYS))}
				>
					<ChevronRight aria-hidden />
				</Button>
			</div>

			{browserTz && browserTz !== timezone ? (
				<p className="text-xs text-muted-foreground">
					Times are in {zoneDisplayName(timezone)} ({timezone}), the shop&apos;s local time.
				</p>
			) : null}

			<div aria-live="polite" aria-busy={loading} className="grid gap-4">
				{loading ? (
					<>
						<span className="sr-only">Loading times…</span>
						<div className="grid grid-cols-3 gap-2" aria-hidden>
							{Array.from({ length: 9 }, (_, i) => (
								<div key={i} className="h-11 animate-pulse rounded-lg bg-muted" />
							))}
						</div>
					</>
				) : current && !current.ok ? (
					<div className="grid justify-items-start gap-2">
						<p role="alert" className="text-sm text-destructive">
							{current.message}
						</p>
						<Button type="button" variant="outline" onClick={() => setRetry((n) => n + 1)}>
							Try again
						</Button>
					</div>
				) : weekIsEmpty ? (
					<div className="grid justify-items-start gap-2">
						<p className="text-sm">No open times this week.</p>
						{data?.nextOpenDate ? (
							<Button
								type="button"
								variant="outline"
								className="min-h-11"
								onClick={() => moveWindow(data.nextOpenDate ?? today, data.nextOpenDate)}
							>
								Jump to {longDateLabel(data.nextOpenDate)}
							</Button>
						) : (
							<p className="text-sm text-muted-foreground">
								There are no online openings right now. Please contact the shop.
							</p>
						)}
					</div>
				) : daySlots.length === 0 ? (
					<div className="grid justify-items-start gap-2">
						<p className="text-sm">No times on {longDateLabel(activeDate)}.</p>
						<Button
							type="button"
							variant="outline"
							className="min-h-11"
							onClick={jumpToNextOpenDay}
						>
							Jump to next open day
						</Button>
					</div>
				) : (
					PERIODS.map(({ id, label }) => {
						const periodSlots = daySlots.filter((s) => s.period === id);
						if (periodSlots.length === 0) return null;
						const headingId = `${idPrefix}-${id}`;
						return (
							<section key={id} aria-labelledby={headingId} className="grid gap-2">
								<h4 id={headingId} className="text-xs font-medium uppercase text-muted-foreground">
									{label}
								</h4>
								<ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
									{periodSlots.map((slot) => {
										const isSelected = selected?.startsAt === slot.startsAt;
										return (
											<li key={slot.startsAt}>
												<button
													type="button"
													aria-pressed={isSelected}
													aria-label={slot.label}
													onClick={() => onPick(slot)}
													className={cn(
														'min-h-11 w-full rounded-lg border px-2 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
														isSelected
															? 'border-primary bg-primary text-primary-foreground'
															: 'bg-background hover:bg-muted',
													)}
												>
													{slot.time}
												</button>
											</li>
										);
									})}
								</ul>
							</section>
						);
					})
				)}
			</div>
		</div>
	);
}

function weekdayShort(date: string): string {
	return longDateLabel(date).slice(0, 3);
}

function monthLong(date: string): string {
	return longDateLabel(date).split(', ')[1]?.split(' ')[0] ?? '';
}
