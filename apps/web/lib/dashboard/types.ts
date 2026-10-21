// Serialisable shapes shared by dashboard server code and client components (no Luxon here).
import type { BookingStatus } from '@/lib/booking/types';
import type { BookingRisk, ConfirmationStatus } from '@/lib/risk/types';

export type Outcome = 'completed' | 'no_show';
export type ManualSource = 'phone' | 'walk_in';
export type CalendarView = 'day' | 'week';

export interface DashboardBooking {
	id: string;
	status: BookingStatus;
	source: string;
	startsAtMs: number;
	endsAtMs: number;
	blockedUntilMs: number;
	/** Shop-local start date (`YYYY-MM-DD`) and time (`HH:mm`), for edit forms. */
	date: string;
	time: string;
	dateLabel: string;
	timeLabel: string;
	staffId: string;
	staffName: string;
	serviceId: string;
	serviceName: string;
	clientId: string;
	clientName: string;
	clientPhone: string | null;
	priceCents: number;
	notes: string | null;
	cancelReason: string | null;
	createdLabel: string;
	/** End of the shop-local day the outcome was marked; undo is allowed before it. */
	undoUntilMs: number | null;
	/** null until the booking has been scored (or when scoring is off). */
	risk: BookingRisk | null;
	confirmation: ConfirmationStatus;
	/** Deadline to confirm, formatted in shop time. */
	confirmationDueLabel: string | null;
}

export interface DashboardSlot {
	time: string;
	label: string;
}

export interface StaffOption {
	id: string;
	name: string;
}

export interface ServiceOption {
	id: string;
	name: string;
	durationMinutes: number;
	priceCents: number;
}

export interface ClientMatch {
	id: string;
	name: string;
	phone: string | null;
}

export type ActionResult =
	| { ok: true; message: string }
	| {
			ok: false;
			message: string;
			fieldErrors?: Record<string, string>;
			suggestions?: DashboardSlot[];
	  };

export type BookingAction = 'markCompleted' | 'markNoShow' | 'undoOutcome' | 'edit' | 'cancel';

/** Buttons to offer; mirrors transitionBooking, and the server re-checks every action. */
export function availableActions(
	booking: Pick<DashboardBooking, 'status' | 'startsAtMs' | 'undoUntilMs'>,
	nowMs: number,
): BookingAction[] {
	switch (booking.status) {
		case 'pending':
			return ['cancel'];
		case 'confirmed':
			return nowMs >= booking.startsAtMs
				? ['markCompleted', 'markNoShow', 'edit', 'cancel']
				: ['edit', 'cancel'];
		case 'completed':
		case 'no_show':
			return booking.undoUntilMs !== null && nowMs < booking.undoUntilMs ? ['undoOutcome'] : [];
		default:
			return [];
	}
}

/** Past its end and still waiting for staff to mark completed / no-show. */
export function needsOutcome(
	booking: Pick<DashboardBooking, 'status' | 'endsAtMs'>,
	nowMs: number,
): boolean {
	return booking.status === 'confirmed' && nowMs >= booking.endsAtMs;
}

export const STATUS_LABELS: Record<BookingStatus, string> = {
	pending: 'Pending',
	confirmed: 'Confirmed',
	completed: 'Completed',
	cancelled: 'Cancelled',
	no_show: 'No-show',
};

export const SOURCE_LABELS: Record<string, string> = {
	direct: 'Online',
	phone: 'Phone',
	walk_in: 'Walk-in',
	waitlist: 'Waitlist',
};

/** Booked by a waitlisted client from an offer text. */
export function isRefill(booking: Pick<DashboardBooking, 'source'>): boolean {
	return booking.source === 'waitlist';
}
