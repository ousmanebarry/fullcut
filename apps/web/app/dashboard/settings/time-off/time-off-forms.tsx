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
import { addTimeOffAction, deleteTimeOffAction } from './actions';

export function AddTimeOffForm({
	staff,
	today,
}: {
	staff: { id: string; display_name: string }[];
	today: string;
}) {
	const [state, action] = useActionState(addTimeOffAction, idleState);
	useFormToast(state);
	const [allDay, setAllDay] = useState(true);
	const errors = state.status === 'error' ? state.fieldErrors : undefined;
	const value = (key: string, fallback = '') => state.values?.[key] ?? fallback;

	return (
		<form action={action} className="grid gap-4 rounded-lg border p-3" noValidate>
			<h2 className="font-medium">Add time off</h2>
			<FormError message={state.status === 'error' && !errors ? state.message : undefined} />
			{staff.length > 1 ? (
				<FieldShell id="staffId" label="Who" error={errors?.staffId}>
					<select
						id="staffId"
						name="staffId"
						className={nativeControlClass}
						defaultValue={value('staffId', staff[0]?.id)}
						{...describedBy('staffId', errors?.staffId)}
					>
						{staff.map((member) => (
							<option key={member.id} value={member.id}>
								{member.display_name}
							</option>
						))}
					</select>
				</FieldShell>
			) : (
				<input type="hidden" name="staffId" value={staff[0]?.id ?? ''} />
			)}
			<label className="flex items-center gap-2 text-sm">
				<input
					type="checkbox"
					name="allDay"
					className="size-4 accent-primary"
					checked={allDay}
					onChange={(event) => setAllDay(event.target.checked)}
				/>
				All day
			</label>
			<div className="grid grid-cols-2 gap-3">
				<TextField
					name="startDate"
					label="From"
					type="date"
					min={today}
					defaultValue={value('startDate', today)}
					error={errors?.startDate}
				/>
				{allDay ? null : (
					<TextField
						name="startTime"
						label="Start time"
						type="time"
						step={300}
						defaultValue={value('startTime', '09:00')}
						error={errors?.startTime}
					/>
				)}
				<TextField
					name="endDate"
					label={allDay ? 'To (last day off)' : 'Until'}
					type="date"
					min={today}
					defaultValue={value('endDate', today)}
					error={errors?.endDate}
				/>
				{allDay ? null : (
					<TextField
						name="endTime"
						label="End time"
						type="time"
						step={300}
						defaultValue={value('endTime', '17:00')}
						error={errors?.endTime}
					/>
				)}
			</div>
			<TextField
				name="reason"
				label="Note (optional)"
				placeholder="Holiday"
				defaultValue={value('reason')}
				error={errors?.reason}
			/>
			<SubmitButton pendingLabel="Adding…" className="justify-self-start">
				Add time off
			</SubmitButton>
		</form>
	);
}

export function DeleteTimeOffButton({ id, label }: { id: string; label: string }) {
	const [state, action] = useActionState(deleteTimeOffAction, idleState);
	useFormToast(state);
	return (
		<form action={action}>
			<input type="hidden" name="timeOffId" value={id} />
			<SubmitButton variant="ghost" pendingLabel="Removing…">
				<span aria-hidden="true">Remove</span>
				<span className="sr-only">Remove time off {label}</span>
			</SubmitButton>
		</form>
	);
}
