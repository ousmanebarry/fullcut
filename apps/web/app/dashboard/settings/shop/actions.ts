'use server';

import { failure, fieldErrorsFrom, formValues, textField, type FormState } from '@/lib/forms';
import { shopProfileSchema } from '@/lib/shop/schemas';
import { updateShopProfile } from '@/lib/shop/settings';
import { settingsActionContext, toFormState } from '../_lib/action';

export async function saveShopProfile(_prev: FormState, formData: FormData): Promise<FormState> {
	const { actor, db } = await settingsActionContext();
	const values = formValues(formData);
	const parsed = shopProfileSchema.safeParse({
		name: textField(formData, 'name'),
		slug: textField(formData, 'slug'),
		timezone: textField(formData, 'timezone'),
		currency: textField(formData, 'currency'),
		phone: textField(formData, 'phone'),
		address: textField(formData, 'address'),
		aboutText: textField(formData, 'aboutText'),
		logoUrl: textField(formData, 'logoUrl'),
	});
	if (!parsed.success)
		return failure('Check the highlighted fields.', fieldErrorsFrom(parsed.error), values);

	return toFormState(
		await updateShopProfile(db, actor, parsed.data),
		'Shop details saved.',
		values,
	);
}
