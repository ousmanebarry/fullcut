// Client-safe risk types, labels and settings previews (no Luxon, no server imports).

export const RISK_TIERS = ['low', 'medium', 'high', 'unknown'] as const;
export type RiskTier = (typeof RISK_TIERS)[number];

export const CONFIRMATION_STATUSES = [
	'not_required',
	'requested',
	'confirmed',
	'unconfirmed',
	'released',
] as const;
export type ConfirmationStatus = (typeof CONFIRMATION_STATUSES)[number];

export const RISK_TIER_LABELS: Record<RiskTier, string> = {
	low: 'Low risk',
	medium: 'Medium risk',
	high: 'High risk',
	unknown: 'Risk unknown',
};

export const CONFIRMATION_LABELS: Record<ConfirmationStatus, string> = {
	not_required: 'No confirmation needed',
	requested: 'Asked to confirm',
	confirmed: 'Client confirmed',
	unconfirmed: 'Unconfirmed',
	released: 'Released',
};

export function isRiskTier(value: string | null): value is RiskTier {
	return value !== null && (RISK_TIERS as readonly string[]).includes(value);
}

export function isConfirmationStatus(value: string): value is ConfirmationStatus {
	return (CONFIRMATION_STATUSES as readonly string[]).includes(value);
}

export interface TierActions {
	confirmRequest: boolean;
	requireConfirmation: boolean;
	extraReminder: boolean;
	suggestStandby: boolean;
}

export interface RiskSettings {
	actionsEnabled: boolean;
	mediumThreshold: number;
	highThreshold: number;
	medium: TierActions;
	high: TierActions;
	autoRelease: boolean;
	confirmCap: number;
	deadlineHours: number;
}

export const DEFAULT_RISK_SETTINGS: RiskSettings = {
	actionsEnabled: false,
	mediumThreshold: 0.15,
	highThreshold: 0.35,
	medium: {
		confirmRequest: true,
		requireConfirmation: false,
		extraReminder: false,
		suggestStandby: false,
	},
	high: {
		confirmRequest: true,
		requireConfirmation: true,
		extraReminder: true,
		suggestStandby: true,
	},
	autoRelease: false,
	confirmCap: 3,
	deadlineHours: 24,
};

/** What the dashboard shows about one booking's risk. */
export interface BookingRisk {
	tier: RiskTier;
	/** 0–1, or null when scoring failed. */
	score: number | null;
	method: 'model' | 'heuristic' | null;
	factors: string[];
	trusted: boolean;
}

/** Share of recent scored bookings per tier, for "about 1 in N" previews. */
export type TierShares = Partial<Record<'medium' | 'high', number>>;

/** Standby clients are shown for unconfirmed bookings, and for tiers the shop chose. */
export function suggestsStandby(
	booking: { risk: BookingRisk | null; confirmation: ConfirmationStatus },
	settings: RiskSettings,
): boolean {
	if (booking.confirmation === 'unconfirmed') return true;
	if (!settings.actionsEnabled || !booking.risk || booking.risk.trusted) return false;
	if (booking.risk.tier === 'high') return settings.high.suggestStandby;
	if (booking.risk.tier === 'medium') return settings.medium.suggestStandby;
	return false;
}

function share(fraction: number | undefined): string {
	if (fraction === undefined || fraction <= 0) return '';
	const n = Math.max(1, Math.round(1 / fraction));
	return n === 1 ? ' (most bookings)' : ` (about 1 in ${n})`;
}

function tierPreview(
	label: string,
	actions: TierActions,
	s: RiskSettings,
	fraction: number | undefined,
): string {
	const parts: string[] = [];
	if (actions.requireConfirmation) {
		parts.push(
			`will be asked to reply YES by ${s.deadlineHours} h before; unconfirmed ones are ${
				s.autoRelease ? 'released and offered to your waitlist' : 'flagged for you'
			}`,
		);
	} else if (actions.confirmRequest) {
		parts.push('get a "reply YES to confirm" text 48 h before');
	}
	if (actions.extraReminder) parts.push('get an extra reminder 3 h before');
	if (actions.suggestStandby) parts.push('show standby clients from your waitlist');
	const what = parts.length > 0 ? parts.join(', ') : 'are treated like any other booking';
	return `${label} bookings${share(fraction)} ${what}.`;
}

/** Plain-language summary of the risk settings, shown live on the settings page. */
export function riskSettingsPreview(s: RiskSettings, shares: TierShares = {}): string[] {
	if (!s.actionsEnabled) {
		return [
			'Automated actions are off. Risk badges still show on bookings, but nothing is sent or changed because of them.',
		];
	}
	return [
		tierPreview('High-risk', s.high, s, shares.high),
		tierPreview('Medium-risk', s.medium, s, shares.medium),
		`A client who showed up after ${s.confirmCap} confirmation request${s.confirmCap === 1 ? '' : 's'} in a row isn't asked again for their next booking.`,
	];
}
