'use server';

import {
	checkboxField,
	failure,
	fieldErrorsFrom,
	formValues,
	textField,
	type FormState,
} from '@/lib/forms';
import { bookingRulesSchema } from '@/lib/shop/schemas';
import { updateBookingRules } from '@/lib/shop/settings';
import { settingsActionContext, toFormState } from '../_lib/action';

export async function saveBookingRules(_prev: FormState, formData: FormData): Promise<FormState> {
	const { actor, db } = await settingsActionContext();
	const values = formValues(formData);
	const parsed = bookingRulesSchema.safeParse({
		slotStepMinutes: textField(formData, 'slotStepMinutes'),
		minLeadMinutes: textField(formData, 'minLeadMinutes'),
		maxHorizonDays: textField(formData, 'maxHorizonDays'),
		bookingPageEnabled: checkboxField(formData, 'bookingPageEnabled'),
	});
	if (!parsed.success)
		return failure('Check the highlighted fields.', fieldErrorsFrom(parsed.error), values);

	return toFormState(
		await updateBookingRules(db, actor, parsed.data),
		'Booking rules saved.',
		values,
	);
}
