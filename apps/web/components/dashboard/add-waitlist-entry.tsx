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
import { TIME_OF_DAY_PRESETS, WEEKDAY_LABELS } from '@/lib/waitlist/types';
import { addEntryAction } from '@/app/dashboard/waitlist/actions';

export interface AddEntryFormProps {
	services: { id: string; name: string }[];
	staff: { id: string; displayName: string }[];
	today: string;
	defaultLatest: string;
}

export function AddEntryForm({ services, staff, today, defaultLatest }: AddEntryFormProps) {
	const [state, action] = useActionState(addEntryAction, idleState);
	useFormToast(state);
	const errors = state.status === 'error' ? state.fieldErrors : undefined;
	const values = state.status === 'error' ? state.values : undefined;

	return (
		<form action={action} className="grid gap-4" noValidate>
			<FormError message={state.status === 'error' && !errors ? state.message : undefined} />
			<div className="grid gap-4 sm:grid-cols-2">
				<TextField
					name="name"
					id="entry-name"
					label="Client name"
					autoComplete="off"
					maxLength={80}
					defaultValue={values?.name}
					error={errors?.name}
				/>
				<TextField
					name="phone"
					id="entry-phone"
					label="Mobile number"
					type="tel"
					inputMode="tel"
					autoComplete="off"
					defaultValue={values?.phone}
					error={errors?.phone}
				/>
				<FieldShell id="entry-service" label="Service" error={errors?.serviceId}>
					<select
						id="entry-service"
						name="serviceId"
						className={nativeControlClass}
						defaultValue={values?.serviceId}
						{...describedBy('entry-service', errors?.serviceId)}
					>
						{services.map((s) => (
							<option key={s.id} value={s.id}>
								{s.name}
							</option>
						))}
					</select>
				</FieldShell>
				<FieldShell id="entry-staff" label="Stylist">
					<select
						id="entry-staff"
						name="staffId"
						className={nativeControlClass}
						defaultValue={values?.staffId ?? 'any'}
					>
						<option value="any">Anyone</option>
						{staff.map((s) => (
							<option key={s.id} value={s.id}>
								{s.displayName}
							</option>
						))}
					</select>
				</FieldShell>
				<TextField
					name="earliestDate"
					id="entry-earliest"
					label="From"
					type="date"
					min={today}
					defaultValue={values?.earliestDate ?? today}
					error={errors?.earliestDate}
				/>
				<TextField
					name="latestDate"
					id="entry-latest"
					label="Until"
					type="date"
					min={today}
					defaultValue={values?.latestDate ?? defaultLatest}
					error={errors?.latestDate}
				/>
			</div>

			<fieldset className="grid gap-2">
				<legend className="mb-1 text-sm font-medium">Days (optional)</legend>
				<div className="flex flex-wrap gap-3">
					{WEEKDAY_LABELS.map((label, weekday) => (
						<label key={label} className="flex items-center gap-1.5 text-sm">
							<input type="checkbox" name="weekdays" value={weekday} className="size-4" />
							{label.slice(0, 3)}
						</label>
					))}
				</div>
			</fieldset>
			<fieldset className="grid gap-2">
				<legend className="mb-1 text-sm font-medium">Time of day (optional)</legend>
				<div className="flex flex-wrap gap-3">
					{TIME_OF_DAY_PRESETS.map((preset) => (
						<label key={preset.id} className="flex items-center gap-1.5 text-sm">
							<input type="checkbox" name="times" value={preset.id} className="size-4" />
							{preset.label} ({preset.start}–{preset.end})
						</label>
					))}
				</div>
			</fieldset>

			<div className="grid gap-1">
				<label className="flex items-start gap-3 text-sm">
					<input
						id="entry-consent"
						type="checkbox"
						name="offersRequested"
						className="mt-0.5 size-4 accent-primary"
						{...describedBy('entry-consent', errors?.offersRequested)}
					/>
					<span>The client asked to be texted when a spot opens.</span>
				</label>
				{errors?.offersRequested ? (
					<p id="entry-consent-error" className="text-sm text-destructive">
						{errors.offersRequested}
					</p>
				) : null}
			</div>

			<SubmitButton className="justify-self-start" pendingLabel="Adding…">
				Add to waitlist
			</SubmitButton>
		</form>
	);
}
