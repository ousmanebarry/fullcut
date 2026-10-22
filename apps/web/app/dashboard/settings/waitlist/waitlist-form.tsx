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
import { idleState } from '@/lib/forms';
import { WAITLIST_MIN_NOTICE_MINUTES, WAITLIST_OFFER_MINUTES } from '@/lib/shop/schemas';
import {
	minutesLabel,
	waitlistPreview,
	type WaitlistSettingsValues as WaitlistSettingsDefaults,
} from '@/lib/waitlist/settings';
import { saveWaitlistSettings } from './actions';

function withCurrent(options: readonly number[], current: number): number[] {
	return options.includes(current) ? [...options] : [...options, current].sort((a, b) => a - b);
}

export function WaitlistSettingsForm({ defaults }: { defaults: WaitlistSettingsDefaults }) {
	const [state, action] = useActionState(saveWaitlistSettings, idleState);
	useFormToast(state);
	const errors = state.status === 'error' ? state.fieldErrors : undefined;
	const [values, setValues] = useState(defaults);
	const set = <K extends keyof WaitlistSettingsDefaults>(
		key: K,
		value: WaitlistSettingsDefaults[K],
	) => setValues((v) => ({ ...v, [key]: value }));

	return (
		<form action={action} className="grid gap-4" noValidate>
			<FormError
				message={state.status === 'error' && !state.fieldErrors ? state.message : undefined}
			/>
			<label className="flex items-start gap-3 rounded-lg border p-3 hover:bg-accent/50">
				<input
					type="checkbox"
					name="enabled"
					className="mt-0.5 size-4 accent-primary"
					checked={values.enabled}
					onChange={(e) => set('enabled', e.target.checked)}
				/>
				<span className="grid gap-0.5">
					<span className="text-sm font-medium">Turn on the waitlist</span>
					<span className="text-sm text-muted-foreground">
						Clients can join from your booking page, and you can add them from the dashboard.
					</span>
				</span>
			</label>

			<TextField
				name="waveSize"
				label="Clients to text at once"
				type="number"
				inputMode="numeric"
				min={1}
				max={10}
				value={String(values.waveSize)}
				onChange={(e) => set('waveSize', Number(e.target.value))}
				error={errors?.waveSize}
			/>

			<FieldShell id="offerMinutes" label="Offer stays open for" error={errors?.offerMinutes}>
				<select
					id="offerMinutes"
					name="offerMinutes"
					className={nativeControlClass}
					value={values.offerMinutes}
					onChange={(e) => set('offerMinutes', Number(e.target.value))}
					{...describedBy('offerMinutes', errors?.offerMinutes)}
				>
					{withCurrent(WAITLIST_OFFER_MINUTES, defaults.offerMinutes).map((m) => (
						<option key={m} value={m}>
							{minutesLabel(m)}
						</option>
					))}
				</select>
			</FieldShell>

			<FieldShell
				id="minNoticeMinutes"
				label="Minimum notice"
				hint="Slots starting sooner than this are never offered."
				error={errors?.minNoticeMinutes}
			>
				<select
					id="minNoticeMinutes"
					name="minNoticeMinutes"
					className={nativeControlClass}
					value={values.minNoticeMinutes}
					onChange={(e) => set('minNoticeMinutes', Number(e.target.value))}
					{...describedBy('minNoticeMinutes', errors?.minNoticeMinutes, 'hint')}
				>
					{withCurrent(WAITLIST_MIN_NOTICE_MINUTES, defaults.minNoticeMinutes).map((m) => (
						<option key={m} value={m}>
							{minutesLabel(m)}
						</option>
					))}
				</select>
			</FieldShell>

			<p aria-live="polite" className="rounded-lg bg-muted/60 p-3 text-sm">
				{waitlistPreview(values)}
			</p>
			<p className="text-sm text-muted-foreground">
				Offers are never texted between 9 PM and 9 AM, and only to clients who asked to be texted.
			</p>
			<SubmitButton className="justify-self-start">Save</SubmitButton>
		</form>
	);
}
