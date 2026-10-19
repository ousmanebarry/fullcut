import type { Instant, LocalDate, LocalTime, TimeZone } from '@/lib/time';

export type StaffId = string;

export interface ShopSchedulingSettings {
	timezone: TimeZone;
	slotStepMinutes: number;
	minLeadMinutes: number;
	maxHorizonDays: number;
}

export const DEFAULT_SCHEDULING = {
	slotStepMinutes: 15,
	minLeadMinutes: 120,
	maxHorizonDays: 60,
} as const satisfies Omit<ShopSchedulingSettings, 'timezone'>;

/** Weekly working hours in shop-local wall-clock time; weekday 0 = Sunday. */
export interface AvailabilityRule {
	staffId: StaffId;
	weekday: number;
	startTime: LocalTime;
	endTime: LocalTime;
}

export interface TimeOff {
	staffId: StaffId;
	startsAt: Instant;
	endsAt: Instant;
}

/** An active booking (`pending` with an unexpired hold, or `confirmed`). */
export interface ExistingBooking {
	staffId: StaffId;
	startsAt: Instant;
	blockedUntil: Instant;
}

export interface Service {
	durationMinutes: number;
	bufferMinutes: number;
}

export interface BookingTimes {
	startsAt: Instant;
	endsAt: Instant;
	blockedUntil: Instant;
}

export interface Slot {
	startsAt: Instant;
	staffId: StaffId;
	localLabel: string;
}

/** Inclusive range of shop-local dates. */
export interface LocalDateRange {
	from: LocalDate;
	to: LocalDate;
}

export interface SchedulingContext {
	settings: ShopSchedulingSettings;
	service: Service;
	rules: readonly AvailabilityRule[];
	timeOff: readonly TimeOff[];
	bookings: readonly ExistingBooking[];
	now: Instant;
	/** Owner-approved learned durations for this service, per staff (milestone 15). */
	durationOverrideMinutesByStaff?: Readonly<Record<StaffId, number>>;
}

export type BookingStatus = 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';

export type BookingEvent =
	| 'depositPaid'
	| 'confirmWithoutDeposit'
	| 'holdExpired'
	| 'cancel'
	| 'markCompleted'
	| 'markNoShow';

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
