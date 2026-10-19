'use client';

import { useActionState } from 'react';
import { TextField } from '@/components/forms/fields';
import { SubmitButton, useFormToast } from '@/components/forms/form-controls';
import { idleState } from '@/lib/forms';
import { addStaff, renameStaff, setStaffActive } from './actions';

export function AddStaffForm() {
	const [state, action] = useActionState(addStaff, idleState);
	useFormToast(state);
	const errors = state.status === 'error' ? state.fieldErrors : undefined;

	return (
		<form action={action} className="flex flex-col gap-3 sm:flex-row sm:items-end" noValidate>
			<TextField
				name="displayName"
				id="new-staff-name"
				label="Add a staff member"
				placeholder="Name clients will see"
				className="flex-1"
				defaultValue={state.values?.displayName}
				error={errors?.displayName}
			/>
			<SubmitButton pendingLabel="Adding…">Add</SubmitButton>
		</form>
	);
}

export function StaffRow({
	staff,
}: {
	staff: { id: string; display_name: string; active: boolean };
}) {
	const [renameState, rename] = useActionState(renameStaff, idleState);
	const [toggleState, toggle] = useActionState(setStaffActive, idleState);
	useFormToast(renameState);
	useFormToast(toggleState);
	const errors = renameState.status === 'error' ? renameState.fieldErrors : undefined;

	return (
		<li className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[1fr_auto] sm:items-end">
			<form action={rename} className="flex flex-col gap-3 sm:flex-row sm:items-end" noValidate>
				<input type="hidden" name="staffId" value={staff.id} />
				<TextField
					name="displayName"
					id={`staff-${staff.id}-name`}
					label={staff.active ? 'Name' : 'Name (inactive)'}
					className="flex-1"
					defaultValue={renameState.values?.displayName ?? staff.display_name}
					error={errors?.displayName}
				/>
				<SubmitButton variant="outline">Save</SubmitButton>
			</form>
			<form action={toggle}>
				<input type="hidden" name="staffId" value={staff.id} />
				<input type="hidden" name="active" value={String(!staff.active)} />
				<SubmitButton variant={staff.active ? 'destructive' : 'secondary'} pendingLabel="Updating…">
					{staff.active ? 'Deactivate' : 'Reactivate'}
				</SubmitButton>
			</form>
		</li>
	);
}
