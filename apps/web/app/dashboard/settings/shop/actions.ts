'use server';

import { failure, fieldErrorsFrom, formValues, textField, type FormState } from '@/lib/forms';
import { shopProfileSchema } from '@/lib/shop/schemas';
import { updateShopProfile } from '@/lib/shop/settings';
import { expirePublicShop, settingsActionContext, toFormState } from '../_lib/action';

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

	const result = await updateShopProfile(db, actor, parsed.data);
	// A new slug may have a cached "not found" from before it existed.
	if (result.ok) await expirePublicShop(parsed.data.slug);
	return toFormState(result, 'Shop details saved.', values);
}
