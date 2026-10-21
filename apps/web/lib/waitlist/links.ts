import {
	addMinutes,
	zonedToInstant,
	type Instant,
	type LocalDate,
	type TimeZone,
} from '@/lib/time';

const LINK_VALID_AFTER_LAST_DATE_MINUTES = 7 * 24 * 60;

/** The view/leave link stays valid a week after the entry's last date. */
export function waitlistLinkExpiry(latestDate: LocalDate, zone: TimeZone): Instant {
	return addMinutes(zonedToInstant(latestDate, 1440, zone), LINK_VALID_AFTER_LAST_DATE_MINUTES);
}

export function waitlistUrl(siteUrl: string, token: string): string {
	return new URL(`/wl/${token}`, siteUrl).toString();
}

export function claimUrl(siteUrl: string, token: string): string {
	return new URL(`/w/${token}`, siteUrl).toString();
}
