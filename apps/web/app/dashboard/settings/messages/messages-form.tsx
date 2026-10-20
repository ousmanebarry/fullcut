'use client';

import { useActionState } from 'react';
import {
	FieldShell,
	FormError,
	TextField,
	describedBy,
	nativeControlClass,
} from '@/components/forms/fields';
import { SubmitButton, useFormToast } from '@/components/forms/form-controls';
import { idleState } from '@/lib/forms';
import { REMINDER_LEAD_HOURS } from '@/lib/shop/schemas';
import { saveMessageSettings } from './actions';

export interface MessageSettingsDefaults {
	confirmationEnabled: boolean;
	reminderEnabled: boolean;
	confirmRequestEnabled: boolean;
	rescheduledEnabled: boolean;
	cancelledEnabled: boolean;
	reminderLeadHours: number;
	signOff: string;
}

type Toggle = keyof Pick<
	MessageSettingsDefaults,
	| 'confirmationEnabled'
	| 'reminderEnabled'
	| 'confirmRequestEnabled'
	| 'rescheduledEnabled'
	| 'cancelledEnabled'
>;

const TOGGLES: { name: Toggle; label: string; hint: string }[] = [
	{
		name: 'confirmationEnabled',
		label: 'Booking confirmations',
		hint: 'Sent right after a client books, with a link to manage the booking.',
	},
	{
		name: 'reminderEnabled',
		label: 'Reminders',
		hint: 'Sent before the appointment (not between 9 PM and 9 AM).',
	},
	{
		name: 'confirmRequestEnabled',
		label: 'Confirmation requests',
		hint: '"Reply YES to confirm", for bookings likely to be missed.',
	},
	{
		name: 'rescheduledEnabled',
		label: 'Rescheduled notices',
		hint: 'Sent when a booking moves to a new time or staff member.',
	},
	{
		name: 'cancelledEnabled',
		label: 'Cancellation notices',
		hint: 'Sent when the shop cancels a booking.',
	},
];

function leadLabel(hours: number) {
	return hours % 24 === 0
		? `${hours / 24} day${hours === 24 ? '' : 's'} before`
		: `${hours} hours before`;
}

export function MessageSettingsForm({ defaults }: { defaults: MessageSettingsDefaults }) {
	const [state, action] = useActionState(saveMessageSettings, idleState);
	useFormToast(state);
	const errors = state.status === 'error' ? state.fieldErrors : undefined;
	const leadOptions: readonly number[] = (REMINDER_LEAD_HOURS as readonly number[]).includes(
		defaults.reminderLeadHours,
	)
		? REMINDER_LEAD_HOURS
		: [defaults.reminderLeadHours, ...REMINDER_LEAD_HOURS];

	return (
		<form action={action} className="grid gap-4" noValidate>
			<FormError
				message={state.status === 'error' && !state.fieldErrors ? state.message : undefined}
			/>
			<fieldset className="grid gap-2">
				<legend className="mb-2 text-sm font-medium">Texts to send</legend>
				{TOGGLES.map((toggle) => (
					<label key={toggle.name} className="flex items-start gap-3 rounded-lg border p-3">
						<input
							type="checkbox"
							name={toggle.name}
							className="mt-0.5 size-4 accent-primary"
							defaultChecked={
								state.values ? state.values[toggle.name] === 'on' : defaults[toggle.name]
							}
						/>
						<span className="grid gap-0.5">
							<span className="text-sm font-medium">{toggle.label}</span>
							<span className="text-sm text-muted-foreground">{toggle.hint}</span>
						</span>
					</label>
				))}
			</fieldset>
			<FieldShell
				id="reminderLeadHours"
				label="Send reminders"
				hint="Clients who book later than this get their confirmation only."
				error={errors?.reminderLeadHours}
			>
				<select
					id="reminderLeadHours"
					name="reminderLeadHours"
					className={nativeControlClass}
					defaultValue={state.values?.reminderLeadHours ?? String(defaults.reminderLeadHours)}
					{...describedBy('reminderLeadHours', errors?.reminderLeadHours, 'hint')}
				>
					{leadOptions.map((hours) => (
						<option key={hours} value={hours}>
							{leadLabel(hours)}
						</option>
					))}
				</select>
			</FieldShell>
			<TextField
				name="signOff"
				label="Sign-off (optional)"
				hint="Added on its own line at the end of every text, e.g. “- Sam at Demo Barbers”. Up to 40 characters."
				maxLength={40}
				defaultValue={state.values?.signOff ?? defaults.signOff}
				error={errors?.signOff}
			/>
			<p className="text-sm text-muted-foreground">
				Every text starts with your shop name. Clients who reply STOP get no more texts from you.
			</p>
			<SubmitButton className="justify-self-start">Save</SubmitButton>
		</form>
	);
}
