'use server';

import { z } from 'zod';
import { failure, fieldErrorsFrom, formValues, textField, type FormState } from '@/lib/forms';
import { serviceSchema } from '@/lib/shop/schemas';
import { NOT_FOUND, createService, moveService, updateService } from '@/lib/shop/settings';
import { settingsActionContext, toFormState } from '../_lib/action';

const serviceIdSchema = z.uuid();

function parseService(formData: FormData) {
	return serviceSchema.safeParse({
		name: textField(formData, 'name'),
		durationMinutes: textField(formData, 'durationMinutes'),
		bufferMinutes: textField(formData, 'bufferMinutes'),
		price: textField(formData, 'price'),
		deposit: textField(formData, 'deposit'),
	});
}

export async function addService(_prev: FormState, formData: FormData): Promise<FormState> {
	const { actor, db } = await settingsActionContext();
	const values = formValues(formData);
	const parsed = parseService(formData);
	if (!parsed.success) return failure(undefined, fieldErrorsFrom(parsed.error), values);

	const result = await createService(db, actor, parsed.data);
	return toFormState(result, `${parsed.data.name} added.`, result.ok ? undefined : values);
}

export async function editService(_prev: FormState, formData: FormData): Promise<FormState> {
	const { actor, db } = await settingsActionContext();
	const values = formValues(formData);
	const serviceId = serviceIdSchema.safeParse(textField(formData, 'serviceId'));
	if (!serviceId.success) return failure(NOT_FOUND.message);
	const parsed = parseService(formData);
	if (!parsed.success) return failure(undefined, fieldErrorsFrom(parsed.error), values);

	return toFormState(
		await updateService(db, actor, serviceId.data, parsed.data),
		'Service saved.',
		values,
	);
}

export async function setServiceActive(_prev: FormState, formData: FormData): Promise<FormState> {
	const { actor, db } = await settingsActionContext();
	const serviceId = serviceIdSchema.safeParse(textField(formData, 'serviceId'));
	if (!serviceId.success) return failure(NOT_FOUND.message);
	const active = textField(formData, 'active') === 'true';

	return toFormState(
		await updateService(db, actor, serviceId.data, { active }),
		active ? 'Service is bookable again.' : 'Service hidden from booking.',
	);
}

export async function reorderService(_prev: FormState, formData: FormData): Promise<FormState> {
	const { actor, db } = await settingsActionContext();
	const serviceId = serviceIdSchema.safeParse(textField(formData, 'serviceId'));
	const direction = z.enum(['up', 'down']).safeParse(textField(formData, 'direction'));
	if (!serviceId.success || !direction.success) return failure(NOT_FOUND.message);

	return toFormState(await moveService(db, actor, serviceId.data, direction.data), 'Order saved.');
}
