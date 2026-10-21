import type { Database } from '@/lib/database.types';
import type { RiskSettings } from './types';

type ShopRow = Database['public']['Tables']['shops']['Row'];

export const RISK_SETTINGS_COLUMNS =
	'risk_actions_enabled, risk_medium_threshold, risk_high_threshold, risk_medium_confirm_request, risk_medium_require_confirmation, risk_medium_extra_reminder, risk_medium_suggest_standby, risk_high_confirm_request, risk_high_require_confirmation, risk_high_extra_reminder, risk_high_suggest_standby, risk_auto_release, risk_confirm_cap, risk_confirm_deadline_hours';

export type RiskSettingsRow = Pick<
	ShopRow,
	| 'risk_actions_enabled'
	| 'risk_medium_threshold'
	| 'risk_high_threshold'
	| 'risk_medium_confirm_request'
	| 'risk_medium_require_confirmation'
	| 'risk_medium_extra_reminder'
	| 'risk_medium_suggest_standby'
	| 'risk_high_confirm_request'
	| 'risk_high_require_confirmation'
	| 'risk_high_extra_reminder'
	| 'risk_high_suggest_standby'
	| 'risk_auto_release'
	| 'risk_confirm_cap'
	| 'risk_confirm_deadline_hours'
>;

export function toRiskSettings(row: RiskSettingsRow): RiskSettings {
	return {
		actionsEnabled: row.risk_actions_enabled,
		mediumThreshold: row.risk_medium_threshold,
		highThreshold: row.risk_high_threshold,
		medium: {
			confirmRequest: row.risk_medium_confirm_request,
			requireConfirmation: row.risk_medium_require_confirmation,
			extraReminder: row.risk_medium_extra_reminder,
			suggestStandby: row.risk_medium_suggest_standby,
		},
		high: {
			confirmRequest: row.risk_high_confirm_request,
			requireConfirmation: row.risk_high_require_confirmation,
			extraReminder: row.risk_high_extra_reminder,
			suggestStandby: row.risk_high_suggest_standby,
		},
		autoRelease: row.risk_auto_release,
		confirmCap: row.risk_confirm_cap,
		deadlineHours: row.risk_confirm_deadline_hours,
	};
}

export function toRiskSettingsRow(s: RiskSettings): RiskSettingsRow {
	return {
		risk_actions_enabled: s.actionsEnabled,
		risk_medium_threshold: s.mediumThreshold,
		risk_high_threshold: s.highThreshold,
		risk_medium_confirm_request: s.medium.confirmRequest || s.medium.requireConfirmation,
		risk_medium_require_confirmation: s.medium.requireConfirmation,
		risk_medium_extra_reminder: s.medium.extraReminder,
		risk_medium_suggest_standby: s.medium.suggestStandby,
		risk_high_confirm_request: s.high.confirmRequest || s.high.requireConfirmation,
		risk_high_require_confirmation: s.high.requireConfirmation,
		risk_high_extra_reminder: s.high.extraReminder,
		risk_high_suggest_standby: s.high.suggestStandby,
		risk_auto_release: s.autoRelease,
		risk_confirm_cap: s.confirmCap,
		risk_confirm_deadline_hours: s.deadlineHours,
	};
}
