// Minimal RFC 5545 calendar file for one appointment. Pure, so the browser can build it.

export interface IcsEvent {
	uid: string;
	startsAt: string;
	endsAt: string;
	stamp: string;
	summary: string;
	location?: string | null;
	description?: string;
	url?: string;
}

export function buildIcs(event: IcsEvent): string {
	const lines = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//Fullcut//Booking//EN',
		'CALSCALE:GREGORIAN',
		'METHOD:PUBLISH',
		'BEGIN:VEVENT',
		`UID:${escapeText(event.uid)}`,
		`DTSTAMP:${icsUtc(event.stamp)}`,
		`DTSTART:${icsUtc(event.startsAt)}`,
		`DTEND:${icsUtc(event.endsAt)}`,
		`SUMMARY:${escapeText(event.summary)}`,
		...(event.location ? [`LOCATION:${escapeText(event.location)}`] : []),
		...(event.description ? [`DESCRIPTION:${escapeText(event.description)}`] : []),
		...(event.url ? [`URL:${event.url}`] : []),
		'END:VEVENT',
		'END:VCALENDAR',
	];
	return lines.map(foldLine).join('\r\n') + '\r\n';
}

/** `2026-10-20T13:00:00.000Z` → `20261020T130000Z`. */
export function icsUtc(iso: string): string {
	return new Date(iso)
		.toISOString()
		.replace(/[-:]/g, '')
		.replace(/\.\d{3}/, '');
}

export function escapeText(value: string): string {
	return value
		.replace(/\\/g, '\\\\')
		.replace(/;/g, '\\;')
		.replace(/,/g, '\\,')
		.replace(/\r?\n/g, '\\n');
}

// Lines longer than 75 octets continue on the next line after a single space.
function foldLine(line: string): string {
	const encoder = new TextEncoder();
	if (encoder.encode(line).length <= 75) return line;
	const parts: string[] = [];
	let current = '';
	for (const char of line) {
		const limit = parts.length === 0 ? 75 : 74;
		if (encoder.encode(current + char).length > limit) {
			parts.push(current);
			current = char;
		} else {
			current += char;
		}
	}
	parts.push(current);
	return parts.join('\r\n ');
}
