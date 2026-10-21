'use server';

import {
	checkboxField,
	failure,
	fieldErrorsFrom,
	formValues,
	textField,
	type FormState,
} from '@/lib/forms';
import { waitlistSettingsSchema } from '@/lib/shop/schemas';
import { updateWaitlistSettings } from '@/lib/shop/settings';
import { settingsActionContext, toFormState } from '../_lib/action';

export async function saveWaitlistSettings(
	_prev: FormState,
	formData: FormData,
): Promise<FormState> {
	const { actor, db } = await settingsActionContext();
	const values = formValues(formData);
	const parsed = waitlistSettingsSchema.safeParse({
		enabled: checkboxField(formData, 'enabled'),
		waveSize: textField(formData, 'waveSize'),
		offerMinutes: textField(formData, 'offerMinutes'),
		minNoticeMinutes: textField(formData, 'minNoticeMinutes'),
	});
	if (!parsed.success)
		return failure('Check the highlighted fields.', fieldErrorsFrom(parsed.error), values);

	return toFormState(
		await updateWaitlistSettings(db, actor, parsed.data),
		'Waitlist settings saved.',
		values,
	);
}
