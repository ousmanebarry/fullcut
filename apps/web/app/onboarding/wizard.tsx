'use client';

import { PlusIcon, Trash2Icon } from 'lucide-react';
import { useActionState, useEffect, useRef, useState } from 'react';
import {
	FieldShell,
	FormError,
	TextField,
	describedBy,
	nativeControlClass,
} from '@/components/forms/fields';
import { SubmitButton } from '@/components/forms/form-controls';
import { HoursEditor, hoursErrorsFrom } from '@/components/shop/hours-editor';
import { Button } from '@/components/ui/button';
import { fieldErrorsFrom, idleState, type FieldErrors, type FormState } from '@/lib/forms';
import { defaultWeeklyHours } from '@/lib/shop/hours';
import { CURRENCIES, onboardingSchema, type OnboardingInput } from '@/lib/shop/schemas';
import { suggestSlug } from '@/lib/shop/slug';
import { completeOnboarding } from './actions';

const STEPS = [
	{ title: 'Name your shop', fields: ['shop.name', 'shop.slug'] },
	{ title: 'Where you work', fields: ['shop.timezone', 'shop.currency'] },
	{ title: 'Your first team member', fields: ['staff.'] },
	{ title: 'What you offer', fields: ['services'] },
	{ title: 'When you work', fields: ['hours'] },
] as const;

const MAX_SERVICES = 3;
const FALLBACK_ZONE = 'America/Toronto';

type ServiceDraft = OnboardingInput['services'][number];

function emptyService(): ServiceDraft {
	return { name: '', durationMinutes: '30', bufferMinutes: '0', price: '' };
}

function errorsForStep(errors: FieldErrors, step: number): FieldErrors {
	const fields: readonly string[] = STEPS[step]?.fields ?? [];
	return Object.fromEntries(
		Object.entries(errors).filter(([key]) => fields.some((f) => key.startsWith(f))),
	);
}

function firstStepWithErrors(errors: FieldErrors): number {
	const index = STEPS.findIndex((_, step) => Object.keys(errorsForStep(errors, step)).length > 0);
	return index === -1 ? STEPS.length - 1 : index;
}

export function OnboardingWizard({
	defaultStaffName,
	timeZones,
}: {
	defaultStaffName: string;
	timeZones: string[];
}) {
	const [step, setStep] = useState(0);
	const [errors, setErrors] = useState<FieldErrors>({});
	const [slugEdited, setSlugEdited] = useState(false);
	const [draft, setDraft] = useState<OnboardingInput>(() => ({
		shop: { name: '', slug: '', timezone: '', currency: 'CAD' },
		staff: { displayName: defaultStaffName },
		services: [emptyService()],
		hours: defaultWeeklyHours(),
	}));

	const [state, formAction] = useActionState(async (prev: FormState, formData: FormData) => {
		const result = await completeOnboarding(prev, formData);
		if (result.status === 'error' && result.fieldErrors) {
			setErrors(result.fieldErrors);
			setStep(firstStepWithErrors(result.fieldErrors));
		}
		return result;
	}, idleState);

	const headingRef = useRef<HTMLHeadingElement>(null);
	const movedRef = useRef(false);
	useEffect(() => {
		if (movedRef.current) headingRef.current?.focus();
		movedRef.current = true;
	}, [step]);

	function validateStep(target: number): boolean {
		const result = onboardingSchema.safeParse(draft);
		const stepErrors = result.success ? {} : errorsForStep(fieldErrorsFrom(result.error), target);
		setErrors(stepErrors);
		return Object.keys(stepErrors).length === 0;
	}

	function next() {
		if (!validateStep(step)) return;
		if (step === 0 && !draft.shop.timezone) {
			const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
			const timezone = timeZones.includes(browserZone) ? browserZone : FALLBACK_ZONE;
			setDraft((d) => ({ ...d, shop: { ...d.shop, timezone } }));
		}
		setStep((s) => Math.min(s + 1, STEPS.length - 1));
	}

	function back() {
		setErrors({});
		setStep((s) => Math.max(s - 1, 0));
	}

	function setShop(patch: Partial<OnboardingInput['shop']>) {
		setDraft((d) => ({ ...d, shop: { ...d.shop, ...patch } }));
	}

	function setService(index: number, patch: Partial<ServiceDraft>) {
		setDraft((d) => ({
			...d,
			services: d.services.map((s, i) => (i === index ? { ...s, ...patch } : s)),
		}));
	}

	const isLast = step === STEPS.length - 1;
	const formMessage = state.status === 'error' && !state.fieldErrors ? state.message : undefined;

	return (
		<form
			action={formAction}
			noValidate
			className="grid gap-6"
			onSubmit={(event) => {
				if (!isLast) {
					event.preventDefault();
					next();
					return;
				}
				const result = onboardingSchema.safeParse(draft);
				if (!result.success) {
					event.preventDefault();
					const all = fieldErrorsFrom(result.error);
					setErrors(all);
					setStep(firstStepWithErrors(all));
				}
			}}
		>
			<input type="hidden" name="payload" value={JSON.stringify(draft)} />

			<div className="grid gap-1">
				<p className="text-sm text-muted-foreground" aria-live="polite">
					Step {step + 1} of {STEPS.length}
				</p>
				<h2 ref={headingRef} tabIndex={-1} className="text-xl font-semibold outline-none">
					{STEPS[step]?.title}
				</h2>
			</div>

			<FormError message={formMessage} />

			{step === 0 ? (
				<div className="grid gap-4">
					<TextField
						name="shopName"
						label="Shop name"
						autoComplete="organization"
						value={draft.shop.name}
						error={errors['shop.name']}
						onChange={(event) => {
							const name = event.target.value;
							setShop(slugEdited ? { name } : { name, slug: suggestSlug(name) });
						}}
					/>
					<TextField
						name="slug"
						label="Booking link"
						hint={`Clients book at fullcut.app/${draft.shop.slug || 'your-shop'}`}
						autoCapitalize="none"
						autoCorrect="off"
						spellCheck={false}
						value={draft.shop.slug}
						error={errors['shop.slug']}
						onChange={(event) => {
							setSlugEdited(true);
							setShop({ slug: event.target.value.toLowerCase() });
						}}
					/>
				</div>
			) : null}

			{step === 1 ? (
				<div className="grid gap-4">
					<FieldShell
						id="timezone"
						label="Timezone"
						error={errors['shop.timezone']}
						hint="Times on your booking page use this zone."
					>
						<select
							id="timezone"
							className={nativeControlClass}
							value={draft.shop.timezone}
							onChange={(event) => setShop({ timezone: event.target.value })}
							{...describedBy('timezone', errors['shop.timezone'], 'hint')}
						>
							{timeZones.map((zone) => (
								<option key={zone} value={zone}>
									{zone.replaceAll('_', ' ')}
								</option>
							))}
						</select>
					</FieldShell>
					<FieldShell id="currency" label="Currency" error={errors['shop.currency']}>
						<select
							id="currency"
							className={nativeControlClass}
							value={draft.shop.currency}
							onChange={(event) =>
								setShop({ currency: event.target.value as OnboardingInput['shop']['currency'] })
							}
							{...describedBy('currency', errors['shop.currency'])}
						>
							{CURRENCIES.map((currency) => (
								<option key={currency} value={currency}>
									{currency}
								</option>
							))}
						</select>
					</FieldShell>
				</div>
			) : null}

			{step === 2 ? (
				<TextField
					name="displayName"
					label="Name clients will see"
					hint="Usually you. You can add more people later."
					autoComplete="name"
					value={draft.staff.displayName}
					error={errors['staff.displayName']}
					onChange={(event) =>
						setDraft((d) => ({ ...d, staff: { displayName: event.target.value } }))
					}
				/>
			) : null}

			{step === 3 ? (
				<div className="grid gap-4">
					<FormError message={errors.services} />
					{draft.services.map((service, index) => (
						<fieldset key={index} className="grid gap-3 rounded-lg border p-3">
							<legend className="px-1 text-sm font-medium">Service {index + 1}</legend>
							<TextField
								name={`service-${index}-name`}
								label="Name"
								placeholder="Haircut"
								value={service.name}
								error={errors[`services.${index}.name`]}
								onChange={(event) => setService(index, { name: event.target.value })}
							/>
							<div className="grid grid-cols-3 gap-2">
								<TextField
									name={`service-${index}-duration`}
									label="Minutes"
									inputMode="numeric"
									value={service.durationMinutes}
									error={errors[`services.${index}.durationMinutes`]}
									onChange={(event) => setService(index, { durationMinutes: event.target.value })}
								/>
								<TextField
									name={`service-${index}-buffer`}
									label="Buffer"
									inputMode="numeric"
									hint="Cleanup min"
									value={service.bufferMinutes}
									error={errors[`services.${index}.bufferMinutes`]}
									onChange={(event) => setService(index, { bufferMinutes: event.target.value })}
								/>
								<TextField
									name={`service-${index}-price`}
									label={`Price (${draft.shop.currency})`}
									inputMode="decimal"
									placeholder="35.00"
									value={service.price}
									error={errors[`services.${index}.price`]}
									onChange={(event) => setService(index, { price: event.target.value })}
								/>
							</div>
							{draft.services.length > 1 ? (
								<Button
									type="button"
									variant="ghost"
									size="sm"
									className="justify-self-start"
									onClick={() =>
										setDraft((d) => ({ ...d, services: d.services.filter((_, i) => i !== index) }))
									}
								>
									<Trash2Icon /> Remove service {index + 1}
								</Button>
							) : null}
						</fieldset>
					))}
					{draft.services.length < MAX_SERVICES ? (
						<Button
							type="button"
							variant="outline"
							className="justify-self-start"
							onClick={() => setDraft((d) => ({ ...d, services: [...d.services, emptyService()] }))}
						>
							<PlusIcon /> Add another service
						</Button>
					) : null}
				</div>
			) : null}

			{step === 4 ? (
				<HoursEditor
					value={draft.hours}
					onChange={(hours) => setDraft((d) => ({ ...d, hours }))}
					errors={hoursErrorsFrom(errors)}
				/>
			) : null}

			<div className="flex items-center justify-between gap-3">
				{step > 0 ? (
					<Button type="button" variant="outline" size="lg" onClick={back}>
						Back
					</Button>
				) : (
					<span />
				)}
				{isLast ? (
					<SubmitButton pendingLabel="Creating your shop…">Create my shop</SubmitButton>
				) : (
					<Button type="submit" size="lg">
						Next
					</Button>
				)}
			</div>
		</form>
	);
}
