'use client';

import { CalendarPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { buildIcs } from '@/lib/public-booking/ics';
import type { BookingDetails } from '@/lib/public-booking/types';

export function AddToCalendarButton({
	booking,
	reference,
	manageUrl,
}: {
	booking: BookingDetails;
	reference: string;
	manageUrl?: string;
}) {
	function download() {
		const ics = buildIcs({
			uid: `${reference}-${booking.startsAt}@fullcut.ca`,
			startsAt: booking.startsAt,
			endsAt: booking.endsAt,
			stamp: new Date().toISOString(),
			summary: `${booking.serviceName} at ${booking.shopName}`,
			location: booking.shopAddress,
			description: [
				`With ${booking.staffName}. Reference ${reference}.`,
				manageUrl ? `Change or cancel: ${manageUrl}` : '',
			]
				.filter(Boolean)
				.join('\n'),
			url: manageUrl,
		});
		const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
		const link = document.createElement('a');
		link.href = url;
		link.download = `booking-${reference}.ics`;
		link.click();
		URL.revokeObjectURL(url);
	}

	return (
		<Button type="button" variant="outline" size="lg" className="h-11" onClick={download}>
			<CalendarPlus aria-hidden />
			Add to calendar
		</Button>
	);
}
