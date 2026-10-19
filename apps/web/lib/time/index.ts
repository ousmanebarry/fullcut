// The only module that imports Luxon (docs/adr/0003-time-library.md).
import { DateTime, IANAZone } from 'luxon';

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

/** UTC instant as epoch milliseconds. */
export type Instant = Brand<number, 'Instant'>;
/** Shop-local calendar date, `YYYY-MM-DD`. */
export type LocalDate = Brand<string, 'LocalDate'>;
/** Shop-local wall-clock time, `HH:mm` or `HH:mm:ss` (`24:00` allowed as an end time). */
export type LocalTime = Brand<string, 'LocalTime'>;
/** Validated IANA timezone name. */
export type TimeZone = Brand<string, 'TimeZone'>;

const MINUTES_PER_DAY = 1440;
const MS_PER_MINUTE = 60_000;
const ISO_OFFSET_SUFFIX = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/i;
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_TIME = /^(?:(?:[01]\d|2[0-3]):[0-5]\d|24:00)(?::00)?$/;

export function instantFromIso(value: string): Instant {
	const parsed = DateTime.fromISO(value, { setZone: true });
	if (!ISO_OFFSET_SUFFIX.test(value) || !parsed.isValid) {
		throw new RangeError(`Invalid ISO instant (an offset is required): ${value}`);
	}
	return parsed.toMillis() as Instant;
}

export function instantToIso(instant: Instant): string {
	return new Date(instant).toISOString();
}

export function localDate(value: string): LocalDate {
	if (!LOCAL_DATE.test(value) || !DateTime.fromISO(value, { zone: 'utc' }).isValid) {
		throw new RangeError(`Invalid local date: ${value}`);
	}
	return value as LocalDate;
}

export function localTime(value: string): LocalTime {
	if (!LOCAL_TIME.test(value)) {
		throw new RangeError(`Invalid local time: ${value}`);
	}
	return value as LocalTime;
}

export function timeZone(value: string): TimeZone {
	if (!IANAZone.isValidZone(value)) {
		throw new RangeError(`Invalid IANA timezone: ${value}`);
	}
	return value as TimeZone;
}

export function addMinutes(instant: Instant, minutes: number): Instant {
	return (instant + minutes * MS_PER_MINUTE) as Instant;
}

export function parseLocalTime(time: LocalTime): number {
	return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

/** 0 = Sunday … 6 = Saturday, matching `availability_rules.weekday`. */
export function weekdayOf(date: LocalDate): number {
	return utcDate(date).weekday % 7;
}

export function eachLocalDate(from: LocalDate, to: LocalDate): LocalDate[] {
	const dates: LocalDate[] = [];
	const end = utcDate(to);
	for (let day = utcDate(from); day <= end; day = day.plus({ days: 1 })) {
		dates.push(day.toFormat('yyyy-MM-dd') as LocalDate);
	}
	return dates;
}

/**
 * Wall-clock `minuteOfDay` on `date` in `zone` as an instant. Times in a DST gap move forward;
 * ambiguous times take the earlier offset. 1440 means midnight at the start of the next day.
 */
export function zonedToInstant(date: LocalDate, minuteOfDay: number, zone: TimeZone): Instant {
	if (!Number.isInteger(minuteOfDay) || minuteOfDay < 0 || minuteOfDay > MINUTES_PER_DAY) {
		throw new RangeError(`Invalid minute of day: ${minuteOfDay}`);
	}
	const day = utcDate(date).plus({ days: minuteOfDay === MINUTES_PER_DAY ? 1 : 0 });
	const minute = minuteOfDay % MINUTES_PER_DAY;
	return DateTime.fromObject(
		{
			year: day.year,
			month: day.month,
			day: day.day,
			hour: Math.floor(minute / 60),
			minute: minute % 60,
		},
		{ zone },
	).toMillis() as Instant;
}

export function localDateOf(instant: Instant, zone: TimeZone): LocalDate {
	return DateTime.fromMillis(instant, { zone }).toFormat('yyyy-MM-dd') as LocalDate;
}

export function localMinuteOfDay(instant: Instant, zone: TimeZone): number {
	const local = DateTime.fromMillis(instant, { zone });
	return local.hour * 60 + local.minute;
}

/** Same wall-clock time `days` calendar days later in `zone`. */
export function addLocalDays(instant: Instant, days: number, zone: TimeZone): Instant {
	return DateTime.fromMillis(instant, { zone }).plus({ days }).toMillis() as Instant;
}

/** e.g. `Mon, Mar 9, 9:00 AM`; adds the zone abbreviation only when the wall time occurs twice. */
export function formatSlotLabel(instant: Instant, zone: TimeZone): string {
	const local = DateTime.fromMillis(instant, { zone, locale: 'en-US' });
	const ambiguous = local.getPossibleOffsets().length > 1;
	return local.toFormat(ambiguous ? 'ccc, LLL d, h:mm a ZZZZ' : 'ccc, LLL d, h:mm a');
}

/** e.g. `9:00 AM`; adds the zone abbreviation only when the wall time occurs twice. */
export function formatLocalTime(instant: Instant, zone: TimeZone): string {
	const local = DateTime.fromMillis(instant, { zone, locale: 'en-US' });
	const ambiguous = local.getPossibleOffsets().length > 1;
	return local.toFormat(ambiguous ? 'h:mm a ZZZZ' : 'h:mm a');
}

/** e.g. `Tuesday, October 20, 2026 at 9:00 AM EDT`. */
export function formatLongDateTime(instant: Instant, zone: TimeZone): string {
	return DateTime.fromMillis(instant, { zone, locale: 'en-US' }).toFormat(
		"cccc, LLLL d, yyyy 'at' h:mm a ZZZZ",
	);
}

/** Weekday, day and month parts for a day picker, e.g. `{ weekday: 'Tue', day: '20', month: 'Oct' }`. */
export function localDateParts(date: LocalDate): { weekday: string; day: string; month: string } {
	const day = utcDate(date).setLocale('en-US');
	return { weekday: day.toFormat('ccc'), day: day.toFormat('d'), month: day.toFormat('LLL') };
}

export function plusDays(date: LocalDate, days: number): LocalDate {
	return utcDate(date).plus({ days }).toFormat('yyyy-MM-dd') as LocalDate;
}

/** Whole calendar days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: LocalDate, to: LocalDate): number {
	return Math.round(utcDate(to).diff(utcDate(from), 'days').days);
}

/** Long zone name at `instant`, e.g. `Eastern Daylight Time`. */
export function zoneLongName(instant: Instant, zone: TimeZone): string {
	return DateTime.fromMillis(instant, { zone, locale: 'en-US' }).toFormat('ZZZZZ');
}

function utcDate(date: LocalDate): DateTime {
	return DateTime.fromISO(date, { zone: 'utc' });
}
