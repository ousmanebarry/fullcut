import { DEFAULT_SCHEDULING } from '@/lib/booking/types';
import type {
	AvailabilityRule,
	ExistingBooking,
	SchedulingContext,
	Service,
	ShopSchedulingSettings,
	StaffId,
	TimeOff,
} from '@/lib/booking/types';
import { instantFromIso, localTime, timeZone, type Instant } from '@/lib/time';

export const toronto = timeZone('America/Toronto');
export const vancouver = timeZone('America/Vancouver');

export const at = (iso: string): Instant => instantFromIso(iso);

export const rule = (
	staffId: StaffId,
	weekday: number,
	start: string,
	end: string,
): AvailabilityRule => ({
	staffId,
	weekday,
	startTime: localTime(start),
	endTime: localTime(end),
});

export const booking = (
	staffId: StaffId,
	startsAt: string,
	blockedUntil: string,
): ExistingBooking => ({
	staffId,
	startsAt: at(startsAt),
	blockedUntil: at(blockedUntil),
});

export const timeOff = (staffId: StaffId, startsAt: string, endsAt: string): TimeOff => ({
	staffId,
	startsAt: at(startsAt),
	endsAt: at(endsAt),
});

export const haircut: Service = { durationMinutes: 30, bufferMinutes: 10 };
export const quick: Service = { durationMinutes: 30, bufferMinutes: 0 };

export function settings(overrides: Partial<ShopSchedulingSettings> = {}): ShopSchedulingSettings {
	return { timezone: toronto, ...DEFAULT_SCHEDULING, ...overrides };
}

export function context(overrides: Partial<SchedulingContext> = {}): SchedulingContext {
	return {
		settings: settings(),
		service: quick,
		rules: [],
		timeOff: [],
		bookings: [],
		now: at('2026-03-01T12:00:00Z'),
		...overrides,
	};
}
