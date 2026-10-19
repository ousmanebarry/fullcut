'use client';

import { useSyncExternalStore } from 'react';

const TICK_MS = 30_000;

function subscribe(onChange: () => void) {
	const timer = setInterval(onChange, TICK_MS);
	window.addEventListener('focus', onChange);
	return () => {
		clearInterval(timer);
		window.removeEventListener('focus', onChange);
	};
}

// Rounded so the snapshot is stable between ticks.
const snapshot = () => Math.floor(Date.now() / TICK_MS) * TICK_MS;

/** Current time in ms, refreshed every 30 s; null while server-rendering/hydrating. */
export function useNow(): number | null {
	return useSyncExternalStore(subscribe, snapshot, () => null);
}

/** Wall-clock minute of the day in `zone`. */
export function zonedMinuteOfDay(zone: string, ms: number): number {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: zone,
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23',
	}).formatToParts(new Date(ms));
	const value = (type: Intl.DateTimeFormatPartTypes) =>
		Number(parts.find((p) => p.type === type)?.value ?? 0);
	return value('hour') * 60 + value('minute');
}

export function minuteToTime(minute: number): string {
	return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}
