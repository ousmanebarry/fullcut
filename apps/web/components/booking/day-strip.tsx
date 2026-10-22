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
	return (
		<div className="flex items-stretch gap-1">
			<Button
				type="button"
				variant="ghost"
				size="icon-lg"
				className="h-auto min-h-11 shrink-0"
				aria-label="Previous week"
				disabled={!canGoBack}
				onClick={onPreviousWeek}
			>
				<ChevronLeft aria-hidden />
			</Button>
			<ul className="grid flex-1 grid-cols-7 gap-1" aria-label="Choose a day">
				{days.map(({ date, weekday, count }) => {
					const active = date === activeDate;
					return (
						<li key={date}>
							<button
								type="button"
								aria-pressed={active}
								onClick={() => onPickDay(date)}
								className={cn(
									'flex min-h-14 w-full flex-col items-center justify-center rounded-lg border text-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
									active
										? 'border-primary bg-primary text-primary-foreground'
										: 'bg-background hover:bg-accent',
									!loading && count === 0 && !active && 'text-muted-foreground',
								)}
							>
								<span>{weekday ?? weekdayShort(date)}</span>{' '}
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
				onClick={onNextWeek}
			>
				<ChevronRight aria-hidden />
			</Button>
		</div>
	);
}

function weekdayShort(date: string): string {
	return longDateLabel(date).slice(0, 3);
}

function monthLong(date: string): string {
	return longDateLabel(date).split(', ')[1]?.split(' ')[0] ?? '';
}
