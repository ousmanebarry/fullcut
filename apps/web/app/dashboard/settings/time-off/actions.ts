'use server';

import { z } from 'zod';
import {
	checkboxField,
	failure,
	fieldErrorsFrom,
	formValues,
	textField,
	type FormState,
} from '@/lib/forms';
import { timeOffFormSchema } from '@/lib/shop/schemas';
import { NOT_FOUND, addTimeOff, deleteTimeOff } from '@/lib/shop/settings';
import { timeOffToInstants } from '@/lib/shop/time-off';
import { timeZone } from '@/lib/time';
import { settingsActionContext, toFormState } from '../_lib/action';

export async function addTimeOffAction(_prev: FormState, formData: FormData): Promise<FormState> {
	const { ctx, actor, db } = await settingsActionContext();
	const values = formValues(formData);
	const parsed = timeOffFormSchema.safeParse({
		staffId: textField(formData, 'staffId'),
		startDate: textField(formData, 'startDate'),
		endDate: textField(formData, 'endDate'),
		allDay: checkboxField(formData, 'allDay'),
		startTime: textField(formData, 'startTime'),
		endTime: textField(formData, 'endTime'),
		reason: textField(formData, 'reason'),
	});
	if (!parsed.success) return failure(undefined, fieldErrorsFrom(parsed.error), values);

	const range = timeOffToInstants(parsed.data, timeZone(ctx.shop.timezone));
	if (!range.ok) return failure(undefined, { endDate: range.error }, values);

	const result = await addTimeOff(db, actor, {
		staffId: parsed.data.staffId,
		startsAt: range.value.startsAt,
		endsAt: range.value.endsAt,
		reason: parsed.data.reason,
	});
	return toFormState(result, 'Time off added.', result.ok ? undefined : values);
}

export async function deleteTimeOffAction(
	_prev: FormState,
	formData: FormData,
): Promise<FormState> {
	const { actor, db } = await settingsActionContext();
	const id = z.uuid().safeParse(textField(formData, 'timeOffId'));
	if (!id.success) return failure(NOT_FOUND.message);
	return toFormState(await deleteTimeOff(db, actor, id.data), 'Time off removed.');
}
