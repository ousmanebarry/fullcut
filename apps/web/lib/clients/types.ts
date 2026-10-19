// Serialisable client-book shapes shared by server code and client components (no Luxon here).
import type { DashboardBooking } from '@/lib/dashboard/types';

export const CLIENT_SORTS = ['name', 'last_visit', 'visits'] as const;
export type ClientSort = (typeof CLIENT_SORTS)[number];

export const CLIENT_SORT_LABELS: Record<ClientSort, string> = {
	name: 'Name',
	last_visit: 'Last visit',
	visits: 'Most visits',
};

export interface ClientListRow {
	id: string;
	name: string;
	phone: string | null;
	lastVisitLabel: string | null;
	visits: number;
	noShows: number;
	nextBookingLabel: string | null;
}

export interface ClientListPage {
	rows: ClientListRow[];
	total: number;
	page: number;
	pageCount: number;
}

export interface ClientNoteView {
	id: string;
	body: string;
	authorName: string;
	createdLabel: string;
	canDelete: boolean;
}

export interface ClientProfile {
	id: string;
	name: string;
	phone: string | null;
	email: string | null;
	firstSource: string | null;
	createdLabel: string;
	anonymised: boolean;
	marketingOptIn: boolean;
	marketingOptInLabel: string | null;
	smsOptedOut: boolean;
	stats: {
		visits: number;
		noShows: number;
		cancellations: number;
		totalBookings: number;
		avgSpendCents: number | null;
		medianIntervalDays: number | null;
	};
	upcoming: DashboardBooking[];
	past: DashboardBooking[];
	notes: ClientNoteView[];
	bookAgain: { serviceId: string | null; staffId: string | null };
}

/** Another client that already has the phone number being saved. */
export interface DuplicateClient {
	id: string;
	name: string;
	phone: string;
	totalBookings: number;
}

export type ClientActionResult =
	| { ok: true; message: string; redirectTo?: string }
	| {
			ok: false;
			message: string;
			fieldErrors?: Record<string, string>;
			duplicate?: DuplicateClient;
	  };

export function bookAgainHref(clientId: string, bookAgain: ClientProfile['bookAgain']): string {
	const params = new URLSearchParams({ new: '1', client: clientId });
	if (bookAgain.serviceId) params.set('service', bookAgain.serviceId);
	if (bookAgain.staffId) params.set('staff', bookAgain.staffId);
	return `/dashboard/calendar?${params}`;
}
