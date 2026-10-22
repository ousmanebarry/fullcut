'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { longDateLabel } from '@/lib/public-booking/client-dates';
import { cn } from '@/lib/utils';

export interface DayStripItem {
	date: string;
	weekday: string | undefined;
	count: number;
}

export function DayStrip({
	days,
	activeDate,
	loading,
	canGoBack,
	onPickDay,
	onPreviousWeek,
	onNextWeek,
}: {
	days: readonly DayStripItem[];
	activeDate: string;
	loading: boolean;
	canGoBack: boolean;
	onPickDay: (date: string) => void;
	onPreviousWeek: () => void;
	onNextWeek: () => void;
}) {
	const first = days[0]?.date;
	const last = days.at(-1)?.date;
	const monthLabel =
		first && last
			? `${monthLong(first)}${monthLong(last) !== monthLong(first) ? ` – ${monthLong(last)}` : ''} ${last.slice(0, 4)}`
			: '';
	return (
		<div className="grid gap-2">
			<div className="flex items-center justify-between gap-2">
				<p className="text-sm font-medium">{monthLabel}</p>
				<div className="flex gap-1">
					<Button
						type="button"
						variant="outline"
						size="icon-lg"
						aria-label="Previous week"
						disabled={!canGoBack}
						onClick={onPreviousWeek}
					>
						<ChevronLeft aria-hidden />
					</Button>
					<Button
						type="button"
						variant="outline"
						size="icon-lg"
						aria-label="Next week"
						onClick={onNextWeek}
					>
						<ChevronRight aria-hidden />
					</Button>
				</div>
			</div>
			<ul className="grid grid-cols-7 gap-1 sm:gap-1.5" aria-label="Choose a day">
				{days.map(({ date, weekday, count }) => {
					const active = date === activeDate;
					return (
						<li key={date}>
							<button
								type="button"
								aria-pressed={active}
								onClick={() => onPickDay(date)}
								className={cn(
									'flex min-h-16 w-full flex-col items-center justify-center rounded-xl border text-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
									active
										? 'border-primary bg-primary text-primary-foreground'
										: 'bg-background hover:bg-accent',
									!loading && count === 0 && !active && 'text-muted-foreground',
								)}
							>
								<span>{weekday ?? weekdayShort(date)}</span>{' '}
								<span className="text-lg font-semibold">{Number(date.slice(8))}</span>
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
		</div>
	);
}

function weekdayShort(date: string): string {
	return longDateLabel(date).slice(0, 3);
}

function monthLong(date: string): string {
	return longDateLabel(date).split(', ')[1]?.split(' ')[0] ?? '';
}
