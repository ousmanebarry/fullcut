'use server';

import { z } from 'zod';
import { failure, fieldErrorsFrom, formValues, textField, type FormState } from '@/lib/forms';
import { staffFormSchema } from '@/lib/shop/schemas';
import { NOT_FOUND, createStaff, updateStaff } from '@/lib/shop/settings';
import { settingsActionContext, toFormState } from '../_lib/action';

const staffIdSchema = z.uuid();

export async function addStaff(_prev: FormState, formData: FormData): Promise<FormState> {
	const { actor, db } = await settingsActionContext();
	const values = formValues(formData);
	const parsed = staffFormSchema.safeParse({ displayName: textField(formData, 'displayName') });
	if (!parsed.success) return failure(undefined, fieldErrorsFrom(parsed.error), values);

	const result = await createStaff(db, actor, parsed.data.displayName);
	return toFormState(result, `${parsed.data.displayName} added.`, result.ok ? undefined : values);
}

export async function renameStaff(_prev: FormState, formData: FormData): Promise<FormState> {
	const { actor, db } = await settingsActionContext();
	const values = formValues(formData);
	const staffId = staffIdSchema.safeParse(textField(formData, 'staffId'));
	if (!staffId.success) return failure(NOT_FOUND.message);
	const parsed = staffFormSchema.safeParse({ displayName: textField(formData, 'displayName') });
	if (!parsed.success) return failure(undefined, fieldErrorsFrom(parsed.error), values);

	return toFormState(
		await updateStaff(db, actor, staffId.data, parsed.data),
		'Name saved.',
		values,
	);
}

export async function setStaffActive(_prev: FormState, formData: FormData): Promise<FormState> {
	const { actor, db } = await settingsActionContext();
	const staffId = staffIdSchema.safeParse(textField(formData, 'staffId'));
	if (!staffId.success) return failure(NOT_FOUND.message);
	const active = textField(formData, 'active') === 'true';

	return toFormState(
		await updateStaff(db, actor, staffId.data, { active }),
		active
			? 'Staff member reactivated.'
			: 'Staff member deactivated. Their past bookings are kept.',
	);
}
