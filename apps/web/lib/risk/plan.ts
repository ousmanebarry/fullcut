// Pure: which texts a scored booking gets, and when (docs/adr/0010-risk-scoring.md).
import { quietHoursEnd, QUIET_HOURS_START_MINUTE } from '@/lib/messaging/rules';
import {
	addMinutes,
	localDateOf,
	localMinuteOfDay,
	plusDays,
	zonedToInstant,
	type Instant,
	type TimeZone,
} from '@/lib/time';
import type { ConfirmationStatus, RiskSettings, RiskTier, TierActions } from './types';

export const CONFIRM_REQUEST_LEAD_MINUTES = 48 * 60;
export const FINAL_WARNING_LEAD_MINUTES = 3 * 60;
export const EXTRA_REMINDER_LEAD_MINUTES = 3 * 60;
/** The client gets at least this long to reply to the request before the final warning. */
export const MIN_REPLY_MINUTES = 2 * 60;
/** Too close to the appointment for a confirmation request to be useful. */
const MIN_CONFIRM_LEAD_MINUTES = 3 * 60;
/** Final warnings planned inside quiet hours go out this long before quiet hours start instead. */
const WARNING_BEFORE_QUIET_MINUTES = 30;

export interface PlanInput {
	tier: RiskTier;
	settings: RiskSettings;
	source: string;
	trusted: boolean;
	confirmationStatus: ConfirmationStatus;
	/** The client already confirmed `confirmCap` risk-based requests in a row and showed up. */
	fairnessCapReached: boolean;
	startsAt: Instant;
	now: Instant;
	timezone: TimeZone;
	/** The waitlist's minimum notice: a release later than this can't be refilled. */
	minNoticeMinutes: number;
}

export interface RiskPlan {
	confirmRequestAt: Instant | null;
	finalWarningAt: Instant | null;
	confirmationDueAt: Instant | null;
	extraReminderAt: Instant | null;
}

export const NO_PLAN: RiskPlan = {
	confirmRequestAt: null,
	finalWarningAt: null,
	confirmationDueAt: null,
	extraReminderAt: null,
};

export function tierActions(settings: RiskSettings, tier: RiskTier): TierActions | null {
	if (tier === 'medium') return settings.medium;
	if (tier === 'high') return settings.high;
	return null;
}

function inQuietHours(at: Instant, zone: TimeZone): boolean {
	return quietHoursEnd(at, zone) !== null;
}

/** Latest moment at or before `at` that is outside quiet hours. */
export function latestSendableBefore(at: Instant, zone: TimeZone): Instant {
	if (!inQuietHours(at, zone)) return at;
	const date = localDateOf(at, zone);
	// Before 09:00 the quiet period started the previous evening.
	const evening = localMinuteOfDay(at, zone) < QUIET_HOURS_START_MINUTE ? plusDays(date, -1) : date;
	return zonedToInstant(evening, QUIET_HOURS_START_MINUTE - WARNING_BEFORE_QUIET_MINUTES, zone);
}

export function planRiskActions(input: PlanInput): RiskPlan {
	const { settings, startsAt, now, timezone: zone } = input;
	const actions = tierActions(settings, input.tier);
	if (!settings.actionsEnabled || !actions || input.trusted || input.source === 'walk_in') {
		return NO_PLAN;
	}

	const extraReminder = addMinutes(startsAt, -EXTRA_REMINDER_LEAD_MINUTES);
	const plan: RiskPlan = {
		...NO_PLAN,
		extraReminderAt: actions.extraReminder && extraReminder > now ? extraReminder : null,
	};

	const askable =
		actions.confirmRequest &&
		!input.fairnessCapReached &&
		(input.confirmationStatus === 'not_required' || input.confirmationStatus === 'requested') &&
		addMinutes(startsAt, -MIN_CONFIRM_LEAD_MINUTES) > now;
	if (!askable) return plan;

	const planned = addMinutes(startsAt, -CONFIRM_REQUEST_LEAD_MINUTES);
	const confirmRequestAt = planned > now ? planned : now;
	plan.confirmRequestAt = confirmRequestAt;
	if (!actions.requireConfirmation) return plan;

	const byDeadlineHours = addMinutes(startsAt, -settings.deadlineHours * 60);
	const byNotice = addMinutes(startsAt, -input.minNoticeMinutes);
	const deadline = byDeadlineHours < byNotice ? byDeadlineHours : byNotice;
	const warning = latestSendableBefore(addMinutes(deadline, -FINAL_WARNING_LEAD_MINUTES), zone);
	// The request itself waits out quiet hours, so measure the reply window from when it really goes.
	const requestSent = quietHoursEnd(confirmRequestAt, zone) ?? confirmRequestAt;
	if (warning < addMinutes(requestSent, MIN_REPLY_MINUTES) || warning >= deadline) {
		// Too late for the full timeline: a confirmation request only, never a release.
		return plan;
	}
	return { ...plan, finalWarningAt: warning, confirmationDueAt: deadline };
}
