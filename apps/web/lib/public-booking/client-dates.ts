// Browser-side date helpers for the booking page. Uses Intl only, so Luxon stays out of the client bundle.

/** Today's `YYYY-MM-DD` in `zone`. */
export function todayInZone(zone: string, now = new Date()): string {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: zone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	}).formatToParts(now);
	const part = (type: Intl.DateTimeFormatPartTypes) =>
		parts.find((p) => p.type === type)?.value ?? '';
	return `${part('year')}-${part('month')}-${part('day')}`;
}

export function addDays(date: string, days: number): string {
	const [y = 0, m = 1, d = 1] = date.split('-').map(Number);
	return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function browserTimeZone(): string | null {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone;
	} catch {
		return null;
	}
}

/** e.g. `Eastern Time` for America/Toronto. */
export function zoneDisplayName(zone: string): string {
	const name = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longGeneric' })
		.formatToParts(new Date())
		.find((p) => p.type === 'timeZoneName')?.value;
	return name ?? zone;
}

/** Long label for a `YYYY-MM-DD` date, e.g. `Tuesday, October 20`. */
export function longDateLabel(date: string): string {
	const [y = 0, m = 1, d = 1] = date.split('-').map(Number);
	return new Intl.DateTimeFormat('en-US', {
		timeZone: 'UTC',
		weekday: 'long',
		month: 'long',
		day: 'numeric',
	}).format(new Date(Date.UTC(y, m - 1, d)));
}
