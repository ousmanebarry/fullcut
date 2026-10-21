// Pure fairness rule: a client who keeps confirming and showing up stops being asked.

export interface PastBooking {
	status: string;
	confirmationStatus: string;
	startsAtMs: number;
}

/** Consecutive most-recent finished visits where the client was asked to confirm and still came. */
export function confirmedShowStreak(history: readonly PastBooking[], nowMs: number): number {
	const finished = history
		.filter((b) => b.startsAtMs < nowMs && (b.status === 'completed' || b.status === 'no_show'))
		.sort((a, b) => b.startsAtMs - a.startsAtMs);
	let streak = 0;
	for (const b of finished) {
		if (b.status !== 'completed' || b.confirmationStatus === 'not_required') break;
		streak++;
	}
	return streak;
}

export function fairnessCapReached(
	history: readonly PastBooking[],
	cap: number,
	nowMs: number,
): boolean {
	return confirmedShowStreak(history, nowMs) >= cap;
}
