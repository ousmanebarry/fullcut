'use client';

import { useActionState, useState } from 'react';
import { FormError } from '@/components/forms/fields';
import { SubmitButton, useFormToast } from '@/components/forms/form-controls';
import { HoursEditor, hoursErrorsFrom } from '@/components/shop/hours-editor';
import { idleState } from '@/lib/forms';
import type { WeeklyHours } from '@/lib/shop/hours';
import { saveHours } from './actions';

export function HoursForm({
	staffId,
	initialHours,
}: {
	staffId: string;
	initialHours: WeeklyHours;
}) {
	const [hours, setHours] = useState(initialHours);
	const [state, action] = useActionState(saveHours, idleState);
	useFormToast(state);
	const fieldErrors = state.status === 'error' ? state.fieldErrors : undefined;

	return (
		<form action={action} className="grid gap-4" noValidate>
			<input type="hidden" name="staffId" value={staffId} />
			<input type="hidden" name="hours" value={JSON.stringify(hours)} />
			<FormError message={state.status === 'error' && !fieldErrors ? state.message : undefined} />
			<HoursEditor value={hours} onChange={setHours} errors={hoursErrorsFrom(fieldErrors)} />
			<SubmitButton className="justify-self-start">Save hours</SubmitButton>
		</form>
	);
}
