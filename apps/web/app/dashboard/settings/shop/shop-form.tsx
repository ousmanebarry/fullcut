'use client';

import { useActionState, useState } from 'react';
import {
	FieldShell,
	FormError,
	TextAreaField,
	TextField,
	describedBy,
	nativeControlClass,
} from '@/components/forms/fields';
import { SubmitButton, useFormToast } from '@/components/forms/form-controls';
import { idleState } from '@/lib/forms';
import { CURRENCIES } from '@/lib/shop/schemas';
import { saveShopProfile } from './actions';

export interface ShopProfileDefaults {
	name: string;
	slug: string;
	timezone: string;
	currency: string;
	phone: string;
	address: string;
	aboutText: string;
	logoUrl: string;
}

export function ShopProfileForm({
	defaults,
	timeZones,
}: {
	defaults: ShopProfileDefaults;
	timeZones: string[];
}) {
	const [state, action] = useActionState(saveShopProfile, idleState);
	useFormToast(state);
	const errors = state.status === 'error' ? state.fieldErrors : undefined;
	const value = (key: keyof ShopProfileDefaults) => state.values?.[key] ?? defaults[key];
	const [slug, setSlug] = useState(defaults.slug);
	const slugChanged = slug.trim() !== defaults.slug;

	return (
		<form action={action} className="grid gap-4" noValidate>
			<FormError
				message={state.status === 'error' && !state.fieldErrors ? state.message : undefined}
			/>
			<TextField
				name="name"
				label="Shop name"
				required
				defaultValue={value('name')}
				error={errors?.name}
			/>
			<TextField
				name="slug"
				label="Booking link"
				hint={
					slugChanged
						? 'Changing your link breaks old links you have shared (Instagram bio, cards, texts).'
						: `fullcut.ca/${slug || 'your-shop'}`
				}
				autoCapitalize="none"
				autoCorrect="off"
				spellCheck={false}
				value={slug}
				onChange={(event) => setSlug(event.target.value.toLowerCase())}
				error={errors?.slug}
			/>
			<div className="grid gap-4 sm:grid-cols-2">
				<FieldShell id="timezone" label="Timezone" error={errors?.timezone}>
					<select
						id="timezone"
						name="timezone"
						className={nativeControlClass}
						defaultValue={value('timezone')}
						{...describedBy('timezone', errors?.timezone)}
					>
						{timeZones.map((zone) => (
							<option key={zone} value={zone}>
								{zone.replaceAll('_', ' ')}
							</option>
						))}
					</select>
				</FieldShell>
				<FieldShell id="currency" label="Currency" error={errors?.currency}>
					<select
						id="currency"
						name="currency"
						className={nativeControlClass}
						defaultValue={value('currency')}
						{...describedBy('currency', errors?.currency)}
					>
						{CURRENCIES.map((currency) => (
							<option key={currency} value={currency}>
								{currency}
							</option>
						))}
					</select>
				</FieldShell>
			</div>
			<TextField
				name="phone"
				label="Phone (optional)"
				type="tel"
				autoComplete="tel"
				defaultValue={value('phone')}
				error={errors?.phone}
			/>
			<TextField
				name="address"
				label="Address (optional)"
				autoComplete="street-address"
				defaultValue={value('address')}
				error={errors?.address}
			/>
			<TextAreaField
				name="aboutText"
				label="About (optional)"
				hint="Shown on your booking page."
				rows={4}
				defaultValue={value('aboutText')}
				error={errors?.aboutText}
			/>
			<TextField
				name="logoUrl"
				label="Logo link (optional)"
				type="url"
				placeholder="https://"
				defaultValue={value('logoUrl')}
				error={errors?.logoUrl}
			/>
			<SubmitButton className="justify-self-start">Save</SubmitButton>
		</form>
	);
}
