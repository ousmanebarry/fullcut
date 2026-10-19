/** IANA zones for a picker, always including the current value. */
export function timeZoneOptions(current?: string): string[] {
	const zones = Intl.supportedValuesOf('timeZone');
	return current && !zones.includes(current) ? [current, ...zones] : zones;
}
