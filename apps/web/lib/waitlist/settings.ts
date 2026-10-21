// Client-safe helpers for the waitlist settings form.

export interface WaitlistSettingsValues {
	enabled: boolean;
	waveSize: number;
	offerMinutes: number;
	minNoticeMinutes: number;
}

export function minutesLabel(minutes: number): string {
	if (minutes % 60 !== 0) return `${minutes} minutes`;
	const hours = minutes / 60;
	return hours === 1 ? '1 hour' : `${hours} hours`;
}

/** Plain-language summary of what the settings do. */
export function waitlistPreview(s: WaitlistSettingsValues): string {
	if (!s.enabled) {
		return 'The waitlist is off: clients cannot join, and freed slots are not offered.';
	}
	const clients = s.waveSize === 1 ? '1 matching client' : `up to ${s.waveSize} matching clients`;
	return `When a slot frees up at least ${minutesLabel(s.minNoticeMinutes)} ahead, we text ${clients}; the first to tap gets it. If nobody books within ${minutesLabel(s.offerMinutes)}, the next clients get a text.`;
}
