'use server';

import { z } from 'zod';
import { failure, fieldErrorsFrom, textField, type FormState } from '@/lib/forms';
import { weeklyHoursJsonSchema } from '@/lib/shop/hours';
import { NOT_FOUND, replaceStaffHours } from '@/lib/shop/settings';
import { settingsActionContext, toFormState } from '../_lib/action';

export async function saveHours(_prev: FormState, formData: FormData): Promise<FormState> {
	const { actor, db } = await settingsActionContext();
	const staffId = z.uuid().safeParse(textField(formData, 'staffId'));
	if (!staffId.success) return failure(NOT_FOUND.message);
	const hours = weeklyHoursJsonSchema.safeParse(textField(formData, 'hours'));
	if (!hours.success) {
		const errors = fieldErrorsFrom(hours.error);
		return failure(
			'Fix the highlighted days.',
			Object.fromEntries(Object.entries(errors).map(([key, message]) => [`hours.${key}`, message])),
		);
	}

	return toFormState(await replaceStaffHours(db, actor, staffId.data, hours.data), 'Hours saved.');
}
