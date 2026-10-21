'use server';

import {
	checkboxField,
	failure,
	fieldErrorsFrom,
	formValues,
	textField,
	type FormState,
} from '@/lib/forms';
import { riskSettingsSchema } from '@/lib/shop/schemas';
import { updateRiskSettings } from '@/lib/shop/settings';
import { settingsActionContext, toFormState } from '../_lib/action';

function tierActions(formData: FormData, tier: 'medium' | 'high') {
	return {
		confirmRequest: checkboxField(formData, `${tier}.confirmRequest`),
		requireConfirmation: checkboxField(formData, `${tier}.requireConfirmation`),
		extraReminder: checkboxField(formData, `${tier}.extraReminder`),
		suggestStandby: checkboxField(formData, `${tier}.suggestStandby`),
	};
}

export async function saveRiskSettings(_prev: FormState, formData: FormData): Promise<FormState> {
	const { actor, db } = await settingsActionContext();
	const values = formValues(formData);
	const parsed = riskSettingsSchema.safeParse({
		actionsEnabled: checkboxField(formData, 'actionsEnabled'),
		mediumThreshold: textField(formData, 'mediumThreshold'),
		highThreshold: textField(formData, 'highThreshold'),
		medium: tierActions(formData, 'medium'),
		high: tierActions(formData, 'high'),
		autoRelease: checkboxField(formData, 'autoRelease'),
		confirmCap: textField(formData, 'confirmCap'),
		deadlineHours: textField(formData, 'deadlineHours'),
	});
	if (!parsed.success)
		return failure('Check the highlighted fields.', fieldErrorsFrom(parsed.error), values);

	return toFormState(
		await updateRiskSettings(db, actor, parsed.data),
		'No-show protection saved.',
		values,
	);
}
