// Shapes returned to the browser by the public booking page and APIs. Nothing here may carry
// shop ids, client data or other bookings.
import type { StartRejection } from '@/lib/booking/validate-requested-start';

export interface PublicService {
	id: string;
	name: string;
	durationMinutes: number;
	priceCents: number;
}

export interface PublicStaff {
	id: string;
	displayName: string;
}

export interface PublicShop {
	slug: string;
	name: string;
	aboutText: string | null;
	address: string | null;
	phone: string | null;
	logoUrl: string | null;
	timezone: string;
	currency: string;
	country: 'CA' | 'US';
	services: PublicService[];
	staff: PublicStaff[];
}

export type DayPeriod = 'morning' | 'afternoon' | 'evening';

export interface PublicSlot {
	startsAt: string;
	staffId: string;
	label: string;
	date: string;
	time: string;
	period: DayPeriod;
}

export interface AvailabilityDay {
	date: string;
	weekday: string;
	day: string;
	month: string;
}

export interface AvailabilityResponse {
	timezone: string;
	days: AvailabilityDay[];
	slots: PublicSlot[];
	/** First shop-local date on or after `from` (within the booking horizon) with an open slot. */
	nextOpenDate: string | null;
}

export interface BookingDetails {
	shopName: string;
	shopAddress: string | null;
	serviceName: string;
	staffName: string;
	startsAt: string;
	endsAt: string;
	label: string;
	durationMinutes: number;
	priceCents: number;
	currency: string;
	timezone: string;
}

export interface BookingCreated {
	reference: string;
	manageUrl: string;
	booking: BookingDetails;
}

export type PublicApiError =
	| { error: 'invalid_request'; message: string; fieldErrors?: Record<string, string> }
	| { error: 'not_found'; message: string }
	| {
			error: 'slot_unavailable';
			reason: StartRejection;
			message: string;
			suggestions: PublicSlot[];
	  }
	| { error: 'slot_taken'; message: string; suggestions: PublicSlot[] }
	| { error: 'too_many_bookings'; message: string }
	| { error: 'rate_limited'; message: string; retryAfterSeconds: number }
	| { error: 'cancel_window_passed'; message: string }
	| { error: 'not_active'; message: string };
