'use client';

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
import type { AvailabilityResponse, PublicSlot, PublicStaff } from '@/lib/public-booking/types';
import { cn } from '@/lib/utils';
import { DayStrip } from './day-strip';
import { SlotList, type SlotListState } from './slot-list';

const WINDOW_DAYS = 7;

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
	const laterOpenDay = days.find((d) => d > activeDate && slotsByDate.has(d));

	function moveWindow(start: string, date: string | null = null) {
		setWindowStart(start < today ? today : start);
		setUserDate(date);
	}

	function jumpToNextOpenDay() {
		if (laterOpenDay) setUserDate(laterOpenDay);
		else moveWindow(addDays(windowStart, WINDOW_DAYS));
	}

	const dayItems = days.map((date) => ({
		date,
		weekday: data?.days.find((d) => d.date === date)?.weekday,
		count: slotsByDate.get(date)?.length ?? 0,
	}));

	const listState: SlotListState =
		current === null
			? { kind: 'loading' }
			: !current.ok
				? { kind: 'error', message: current.message }
				: current.data.slots.length === 0
					? { kind: 'week-empty', nextOpenDate: current.data.nextOpenDate ?? null }
					: { kind: 'day', date: activeDate, slots: slotsByDate.get(activeDate) ?? [] };

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
										: 'bg-background hover:bg-accent',
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

			<DayStrip
				days={dayItems}
				activeDate={activeDate}
				loading={loading}
				canGoBack={windowStart > today}
				onPickDay={setUserDate}
				onPreviousWeek={() => moveWindow(addDays(windowStart, -WINDOW_DAYS))}
				onNextWeek={() => moveWindow(addDays(windowStart, WINDOW_DAYS))}
			/>

			<div className="flex flex-wrap items-center justify-between gap-2">
				<h3 className="font-medium">{longDateLabel(activeDate)}</h3>
				<Button
					type="button"
					variant="ghost"
					className="h-10 px-2 text-primary hover:text-primary"
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

			{browserTz && browserTz !== timezone ? (
				<p className="text-xs text-muted-foreground">
					Times are in {zoneDisplayName(timezone)} ({timezone}), the shop&apos;s local time.
				</p>
			) : null}

			<SlotList
				state={listState}
				selected={selected}
				idPrefix={idPrefix}
				onPick={onPick}
				onRetry={() => setRetry((n) => n + 1)}
				onJumpToDate={(date) => moveWindow(date, date)}
				onJumpToNextDay={jumpToNextOpenDay}
			/>
		</div>
	);
}
