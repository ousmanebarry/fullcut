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
import { StickyActionBar } from '@/components/layout/sticky-action-bar';
import { idleState } from '@/lib/forms';
import { SLOT_STEPS } from '@/lib/shop/schemas';
import { saveBookingRules } from './actions';

const LEAD_TIMES = [
	[0, 'No minimum'],
	[30, '30 minutes'],
	[60, '1 hour'],
	[120, '2 hours'],
	[240, '4 hours'],
	[720, '12 hours'],
	[1440, '1 day'],
	[2880, '2 days'],
	[10080, '7 days'],
] as const;

export interface BookingRulesDefaults {
	slotStepMinutes: number;
	minLeadMinutes: number;
	maxHorizonDays: number;
	cancelCutoffHours: number;
	maxActiveBookingsPerPhone: number;
	bookingPageEnabled: boolean;
}

export function BookingRulesForm({ defaults }: { defaults: BookingRulesDefaults }) {
	const [state, action] = useActionState(saveBookingRules, idleState);
	useFormToast(state);
	const errors = state.status === 'error' ? state.fieldErrors : undefined;
	const leadOptions = LEAD_TIMES.some(([minutes]) => minutes === defaults.minLeadMinutes)
		? LEAD_TIMES
		: ([[defaults.minLeadMinutes, `${defaults.minLeadMinutes} minutes`], ...LEAD_TIMES] as const);

	return (
		<form action={action} className="grid gap-4" noValidate>
			<FormError
				message={state.status === 'error' && !state.fieldErrors ? state.message : undefined}
			/>
			<label className="flex items-start gap-3 rounded-lg border p-3 hover:bg-accent/50">
				<input
					type="checkbox"
					name="bookingPageEnabled"
					className="mt-0.5 size-4 accent-primary"
					defaultChecked={
						state.values ? state.values.bookingPageEnabled === 'on' : defaults.bookingPageEnabled
					}
				/>
				<span className="grid gap-0.5">
					<span className="text-sm font-medium">Booking page is on</span>
					<span className="text-sm text-muted-foreground">
						Turn off to stop new online bookings.
					</span>
				</span>
			</label>
			<FieldShell
				id="slotStepMinutes"
				label="Start times every"
				hint="How often a new start time is offered."
				error={errors?.slotStepMinutes}
			>
				<select
					id="slotStepMinutes"
					name="slotStepMinutes"
					className={nativeControlClass}
					defaultValue={state.values?.slotStepMinutes ?? String(defaults.slotStepMinutes)}
					{...describedBy('slotStepMinutes', errors?.slotStepMinutes, 'hint')}
				>
					{SLOT_STEPS.map((step) => (
						<option key={step} value={step}>
							{step} minutes
						</option>
					))}
				</select>
			</FieldShell>
			<FieldShell
				id="minLeadMinutes"
				label="Minimum notice"
				hint="Clients can't book closer to the start time than this."
				error={errors?.minLeadMinutes}
			>
				<select
					id="minLeadMinutes"
					name="minLeadMinutes"
					className={nativeControlClass}
					defaultValue={state.values?.minLeadMinutes ?? String(defaults.minLeadMinutes)}
					{...describedBy('minLeadMinutes', errors?.minLeadMinutes, 'hint')}
				>
					{leadOptions.map(([minutes, label]) => (
						<option key={minutes} value={minutes}>
							{label}
						</option>
					))}
				</select>
			</FieldShell>
			<TextField
				name="maxHorizonDays"
				label="Book up to (days ahead)"
				inputMode="numeric"
				defaultValue={state.values?.maxHorizonDays ?? String(defaults.maxHorizonDays)}
				error={errors?.maxHorizonDays}
			/>
			<TextField
				name="cancelCutoffHours"
				label="Online changes allowed until (hours before)"
				hint="Clients can cancel or reschedule from their link until this many hours before the start."
				inputMode="numeric"
				defaultValue={state.values?.cancelCutoffHours ?? String(defaults.cancelCutoffHours)}
				error={errors?.cancelCutoffHours}
			/>
			<TextField
				name="maxActiveBookingsPerPhone"
				label="Upcoming bookings per client"
				hint="Most upcoming online bookings one phone number can hold at once."
				inputMode="numeric"
				defaultValue={
					state.values?.maxActiveBookingsPerPhone ?? String(defaults.maxActiveBookingsPerPhone)
				}
				error={errors?.maxActiveBookingsPerPhone}
			/>
			<StickyActionBar>
				<SubmitButton>Save</SubmitButton>
			</StickyActionBar>
		</form>
	);
}
