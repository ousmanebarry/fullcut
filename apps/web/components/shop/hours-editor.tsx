'use client';

import { PlusIcon, XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { nativeControlClass } from '@/components/forms/fields';
import { WEEKDAY_NAMES, type DayHours, type TimeWindow, type WeeklyHours } from '@/lib/shop/hours';

interface HoursEditorProps {
	value: WeeklyHours;
	onChange: (next: WeeklyHours) => void;
	/** Error message per weekday index. */
	errors?: Partial<Record<number, string>>;
	idPrefix?: string;
}

const MAX_WINDOWS = 6;

function hhmm(minutes: number): string {
	return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

// One hour after the last range, clamped to the end of the day.
function nextWindow(last: TimeWindow | undefined): TimeWindow {
	const [h = 17, m = 0] = (last?.end ?? '17:00').split(':').map(Number);
	const start = Math.min(h * 60 + m, 22 * 60 + 55);
	return { start: hhmm(start), end: hhmm(Math.min(start + 60, 23 * 60 + 55)) };
}

export function HoursEditor({
	value,
	onChange,
	errors = {},
	idPrefix = 'hours',
}: HoursEditorProps) {
	function updateDay(weekday: number, patch: Partial<DayHours>) {
		onChange(value.map((day) => (day.weekday === weekday ? { ...day, ...patch } : day)));
	}

	return (
		<fieldset className="grid gap-3">
			<legend className="sr-only">Weekly hours</legend>
			{value.map((day) => {
				const name = WEEKDAY_NAMES[day.weekday] ?? '';
				const error = errors[day.weekday];
				const errorId = `${idPrefix}-${day.weekday}-error`;
				return (
					<div
						key={day.weekday}
						className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[9rem_1fr] sm:items-start"
					>
						<label className="flex min-h-9 items-center gap-2 text-sm font-medium">
							<input
								type="checkbox"
								className="size-4 accent-primary"
								checked={day.enabled}
								onChange={(event) => updateDay(day.weekday, { enabled: event.target.checked })}
							/>
							{name}
						</label>
						{day.enabled ? (
							<div className="grid gap-2">
								{day.windows.map((window, index) => (
									<div key={index} className="flex items-center gap-2">
										<input
											type="time"
											step={300}
											aria-label={`${name} range ${index + 1} start`}
											aria-invalid={error ? true : undefined}
											aria-describedby={error ? errorId : undefined}
											className={nativeControlClass}
											value={window.start}
											onChange={(event) =>
												updateDay(day.weekday, {
													windows: day.windows.map((w, i) =>
														i === index ? { ...w, start: event.target.value } : w,
													),
												})
											}
										/>
										<span aria-hidden="true">–</span>
										<input
											type="time"
											step={300}
											aria-label={`${name} range ${index + 1} end`}
											aria-invalid={error ? true : undefined}
											aria-describedby={error ? errorId : undefined}
											className={nativeControlClass}
											value={window.end}
											onChange={(event) =>
												updateDay(day.weekday, {
													windows: day.windows.map((w, i) =>
														i === index ? { ...w, end: event.target.value } : w,
													),
												})
											}
										/>
										<Button
											type="button"
											variant="ghost"
											size="icon-lg"
											aria-label={`Remove ${name} range ${index + 1}`}
											disabled={day.windows.length === 1}
											onClick={() =>
												updateDay(day.weekday, {
													windows: day.windows.filter((_, i) => i !== index),
												})
											}
										>
											<XIcon />
										</Button>
									</div>
								))}
								{day.windows.length < MAX_WINDOWS ? (
									<Button
										type="button"
										variant="ghost"
										size="sm"
										className="justify-self-start"
										onClick={() =>
											updateDay(day.weekday, {
												windows: [...day.windows, nextWindow(day.windows.at(-1))],
											})
										}
									>
										<PlusIcon /> Add a time range
									</Button>
								) : null}
								{error ? (
									<p id={errorId} className="text-sm text-destructive">
										{error}
									</p>
								) : null}
							</div>
						) : (
							<p className="flex min-h-9 items-center text-sm text-muted-foreground">Closed</p>
						)}
					</div>
				);
			})}
		</fieldset>
	);
}

/** Pulls per-day messages out of field errors keyed like "hours.3". */
export function hoursErrorsFrom(fieldErrors: Record<string, string> | undefined, prefix = 'hours') {
	const result: Partial<Record<number, string>> = {};
	for (const [key, message] of Object.entries(fieldErrors ?? {})) {
		const match = new RegExp(`^${prefix}\\.(\\d)$`).exec(key);
		if (match) result[Number(match[1])] = message;
	}
	return result;
}
