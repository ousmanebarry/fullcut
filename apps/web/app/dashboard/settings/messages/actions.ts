'use server';

import {
	checkboxField,
	failure,
	fieldErrorsFrom,
	formValues,
	textField,
	type FormState,
} from '@/lib/forms';
import { messageSettingsSchema } from '@/lib/shop/schemas';
import { updateMessageSettings } from '@/lib/shop/settings';
import { settingsActionContext, toFormState } from '../_lib/action';

export async function saveMessageSettings(
	_prev: FormState,
	formData: FormData,
): Promise<FormState> {
	const { actor, db } = await settingsActionContext();
	const values = formValues(formData);
	const parsed = messageSettingsSchema.safeParse({
		confirmationEnabled: checkboxField(formData, 'confirmationEnabled'),
		reminderEnabled: checkboxField(formData, 'reminderEnabled'),
		confirmRequestEnabled: checkboxField(formData, 'confirmRequestEnabled'),
		rescheduledEnabled: checkboxField(formData, 'rescheduledEnabled'),
		cancelledEnabled: checkboxField(formData, 'cancelledEnabled'),
		reminderLeadHours: textField(formData, 'reminderLeadHours'),
		signOff: textField(formData, 'signOff'),
	});
	if (!parsed.success)
		return failure('Check the highlighted fields.', fieldErrorsFrom(parsed.error), values);

	return toFormState(
		await updateMessageSettings(db, actor, parsed.data),
		'Text message settings saved.',
		values,
	);
}
