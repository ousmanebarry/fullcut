'use client';

import { useActionState, useState } from 'react';
import {
	FieldShell,
	FormError,
	TextField,
	describedBy,
	nativeControlClass,
} from '@/components/forms/fields';
import { SubmitButton, useFormToast } from '@/components/forms/form-controls';
import { StickyActionBar } from '@/components/layout/sticky-action-bar';
import { idleState } from '@/lib/forms';
import {
	riskSettingsPreview,
	type RiskSettings,
	type TierActions,
	type TierShares,
} from '@/lib/risk/types';
import {
	RISK_DEADLINE_HOURS,
	RISK_HIGH_THRESHOLDS,
	RISK_MEDIUM_THRESHOLDS,
} from '@/lib/shop/schemas';
import { saveRiskSettings } from './actions';

function withCurrent(options: readonly number[], current: number): number[] {
	return options.includes(current) ? [...options] : [...options, current].sort((a, b) => a - b);
}

const percent = (value: number) => `${Math.round(value * 100)}% chance or more`;

const ACTION_LABELS: Record<keyof TierActions, { label: string; hint: string }> = {
	confirmRequest: {
		label: 'Ask them to reply YES',
		hint: 'A "reply YES to confirm" text 48 hours before.',
	},
	requireConfirmation: {
		label: 'Require a reply by a deadline',
		hint: 'A final warning names the deadline; unconfirmed bookings are flagged (or released, below).',
	},
	extraReminder: { label: 'Send an extra reminder', hint: 'A short text 3 hours before.' },
	suggestStandby: {
		label: 'Suggest standby clients',
		hint: 'Shows waitlisted clients who could take the slot.',
	},
};

function Checkbox({
	name,
	checked,
	onChange,
	label,
	hint,
	disabled,
}: {
	name: string;
	checked: boolean;
	onChange: (checked: boolean) => void;
	label: string;
	hint?: string;
	disabled?: boolean;
}) {
	return (
		<label className="flex items-start gap-3">
			<input
				type="checkbox"
				name={name}
				className="mt-0.5 size-4 accent-primary"
				checked={checked}
				disabled={disabled}
				onChange={(e) => onChange(e.target.checked)}
			/>
			<span className="grid gap-0.5">
				<span className="text-sm font-medium">{label}</span>
				{hint ? <span className="text-sm text-muted-foreground">{hint}</span> : null}
			</span>
		</label>
	);
}

export function RiskSettingsForm({
	defaults,
	shares,
}: {
	defaults: RiskSettings;
	shares: TierShares;
}) {
	const [state, action] = useActionState(saveRiskSettings, idleState);
	useFormToast(state);
	const errors = state.status === 'error' ? state.fieldErrors : undefined;
	const [values, setValues] = useState(defaults);
	const set = <K extends keyof RiskSettings>(key: K, value: RiskSettings[K]) =>
		setValues((v) => ({ ...v, [key]: value }));
	const setAction = (tier: 'medium' | 'high', key: keyof TierActions, checked: boolean) =>
		setValues((v) => {
			const next = { ...v[tier], [key]: checked };
			// Requiring a reply implies asking for one.
			if (key === 'requireConfirmation' && checked) next.confirmRequest = true;
			if (key === 'confirmRequest' && !checked) next.requireConfirmation = false;
			return { ...v, [tier]: next };
		});

	return (
		<form action={action} className="grid gap-5" noValidate>
			<FormError
				message={state.status === 'error' && !state.fieldErrors ? state.message : undefined}
			/>
			<p className="text-sm text-muted-foreground">
				Every booking gets a no-show risk rating from the client&apos;s history with you and how far
				ahead they booked. Ratings are a guide: nothing below happens unless you turn it on, and you
				can trust any client from the booking itself. Age, gender and where someone lives are never
				used.
			</p>

			<label className="flex items-start gap-3 rounded-lg border p-3 hover:bg-accent/50">
				<input
					type="checkbox"
					name="actionsEnabled"
					className="mt-0.5 size-4 accent-primary"
					checked={values.actionsEnabled}
					onChange={(e) => set('actionsEnabled', e.target.checked)}
				/>
				<span className="grid gap-0.5">
					<span className="text-sm font-medium">Act on risky bookings</span>
					<span className="text-sm text-muted-foreground">
						Turn off to keep the ratings but send nothing extra.
					</span>
				</span>
			</label>

			<div className="grid gap-4 sm:grid-cols-2">
				<FieldShell id="mediumThreshold" label="Medium risk from" error={errors?.mediumThreshold}>
					<select
						id="mediumThreshold"
						name="mediumThreshold"
						className={nativeControlClass}
						value={values.mediumThreshold}
						onChange={(e) => set('mediumThreshold', Number(e.target.value))}
						{...describedBy('mediumThreshold', errors?.mediumThreshold)}
					>
						{withCurrent(RISK_MEDIUM_THRESHOLDS, defaults.mediumThreshold).map((t) => (
							<option key={t} value={t}>
								{percent(t)}
							</option>
						))}
					</select>
				</FieldShell>
				<FieldShell id="highThreshold" label="High risk from" error={errors?.highThreshold}>
					<select
						id="highThreshold"
						name="highThreshold"
						className={nativeControlClass}
						value={values.highThreshold}
						onChange={(e) => set('highThreshold', Number(e.target.value))}
						{...describedBy('highThreshold', errors?.highThreshold)}
					>
						{withCurrent(RISK_HIGH_THRESHOLDS, defaults.highThreshold).map((t) => (
							<option key={t} value={t}>
								{percent(t)}
							</option>
						))}
					</select>
				</FieldShell>
			</div>

			{(['high', 'medium'] as const).map((tier) => (
				<fieldset key={tier} className="grid gap-3 rounded-lg border p-3">
					<legend className="px-1 text-sm font-medium">
						{tier === 'high' ? 'High-risk bookings' : 'Medium-risk bookings'}
					</legend>
					{(Object.keys(ACTION_LABELS) as (keyof TierActions)[]).map((key) => (
						<Checkbox
							key={key}
							name={`${tier}.${key}`}
							checked={values[tier][key]}
							onChange={(checked) => setAction(tier, key, checked)}
							label={ACTION_LABELS[key].label}
							hint={ACTION_LABELS[key].hint}
						/>
					))}
				</fieldset>
			))}

			<FieldShell
				id="deadlineHours"
				label="Confirmation deadline"
				hint="Never later than your waitlist's minimum notice, so a freed slot can still be refilled."
				error={errors?.deadlineHours}
			>
				<select
					id="deadlineHours"
					name="deadlineHours"
					className={nativeControlClass}
					value={values.deadlineHours}
					onChange={(e) => set('deadlineHours', Number(e.target.value))}
					{...describedBy('deadlineHours', errors?.deadlineHours, 'hint')}
				>
					{withCurrent(RISK_DEADLINE_HOURS, defaults.deadlineHours).map((h) => (
						<option key={h} value={h}>
							{h} hours before
						</option>
					))}
				</select>
			</FieldShell>

			<div className="rounded-lg border p-3">
				<Checkbox
					name="autoRelease"
					checked={values.autoRelease}
					onChange={(checked) => set('autoRelease', checked)}
					label="Release unconfirmed bookings automatically"
					hint="Off: unconfirmed bookings are flagged and you decide. On: they're cancelled with a text to the client and offered to your waitlist. Only ever after a final warning went out."
				/>
			</div>

			<TextField
				name="confirmCap"
				label="Stop asking after this many confirmed visits in a row"
				type="number"
				inputMode="numeric"
				min={1}
				max={10}
				value={String(values.confirmCap)}
				onChange={(e) => set('confirmCap', Number(e.target.value))}
				error={errors?.confirmCap}
			/>

			<div aria-live="polite" className="grid gap-1 rounded-lg bg-muted/60 p-3 text-sm">
				{riskSettingsPreview(values, shares).map((line) => (
					<p key={line}>{line}</p>
				))}
			</div>
			<p className="text-sm text-muted-foreground">
				Texts are never sent between 9 PM and 9 AM, and clients who replied STOP get none.
			</p>
			<StickyActionBar>
				<SubmitButton>Save</SubmitButton>
			</StickyActionBar>
		</form>
	);
}
