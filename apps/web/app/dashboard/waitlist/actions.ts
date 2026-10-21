'use server';

import { refresh } from 'next/cache';
import { requireShopMember, toActor } from '@/lib/auth/session';
import { idSchema } from '@/lib/dashboard/schemas';
import {
	checkboxField,
	failure,
	fieldErrorsFrom,
	formValues,
	success,
	textField,
	type FormState,
} from '@/lib/forms';
import { createClient } from '@/lib/supabase/server';
import { timeZone, type Instant } from '@/lib/time';
import { addEntryForClient, cancelEntry } from '@/lib/waitlist/dashboard';
import { staffEntrySchema } from '@/lib/waitlist/staff-schema';

export async function addEntryAction(_prev: FormState, formData: FormData): Promise<FormState> {
	const ctx = await requireShopMember();
	const values = formValues(formData);
	const parsed = staffEntrySchema.safeParse({
		name: textField(formData, 'name'),
		phone: textField(formData, 'phone'),
		serviceId: textField(formData, 'serviceId'),
		staffId: textField(formData, 'staffId'),
		earliestDate: textField(formData, 'earliestDate'),
		latestDate: textField(formData, 'latestDate'),
		weekdays: formData.getAll('weekdays').map(String),
		times: formData.getAll('times').map(String),
		offersRequested: checkboxField(formData, 'offersRequested'),
	});
	if (!parsed.success) {
		return failure('Check the highlighted fields.', fieldErrorsFrom(parsed.error), values);
	}

	const result = await addEntryForClient(
		await createClient(),
		toActor(ctx),
		{
			currency: ctx.shop.currency,
			timezone: timeZone(ctx.shop.timezone),
			maxHorizonDays: ctx.shop.max_horizon_days,
		},
		parsed.data,
		Date.now() as Instant,
	);
	if (!result.ok) {
		const { field, message } = result.error;
		return failure(message, field ? { [field]: message } : undefined, values);
	}
	refresh();
	return success('Added to the waitlist.');
}

export async function cancelEntryAction(formData: FormData): Promise<void> {
	const id = idSchema.safeParse(formData.get('id'));
	if (!id.success) return;
	const ctx = await requireShopMember();
	await cancelEntry(await createClient(), toActor(ctx), id.data);
	refresh();
}
