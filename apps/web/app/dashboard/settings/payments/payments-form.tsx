'use client';

import { useActionState } from 'react';
import {
	FieldShell,
	FormError,
	TextField,
	describedBy,
	nativeControlClass,
} from '@/components/forms/fields';
import { SubmitButton, useFormToast } from '@/components/forms/form-controls';
import { idleState } from '@/lib/forms';
import type { DepositMode, DepositType } from '@/lib/payments/policy';
import { connectStripe, savePaymentSettings } from './actions';

export function ConnectStripeButton({ label }: { label: string }) {
	const [state, action] = useActionState(connectStripe, idleState);
	useFormToast(state);
	return (
		<form action={action} className="grid gap-2">
			<FormError message={state.status === 'error' ? state.message : undefined} />
			<SubmitButton pendingLabel="Opening Stripe…" className="justify-self-start">
				{label}
			</SubmitButton>
		</form>
	);
}

export interface PaymentSettingsDefaults {
	depositMode: DepositMode;
	depositType: DepositType;
	/** Dollars, e.g. "20.00". */
	depositAmount: string;
	depositPercent: string;
	freeCancelHours: string;
	lateCancelKeepsDeposit: boolean;
	noShowKeepsDeposit: boolean;
}

const MODES: { value: DepositMode; label: string; hint: string }[] = [
	{ value: 'off', label: 'No deposits', hint: 'Clients book without paying online.' },
	{
		value: 'all_bookings',
		label: 'Every booking',
		hint: 'The same deposit for every online booking.',
	},
	{
		value: 'per_service',
		label: 'Set per service',
		hint: 'Each service uses the deposit set on the Services page; services without one need none.',
	},
];

export function PaymentSettingsForm({
	defaults,
	currency,
	chargesEnabled,
}: {
	defaults: PaymentSettingsDefaults;
	currency: string;
	chargesEnabled: boolean;
}) {
	const [state, action] = useActionState(savePaymentSettings, idleState);
	useFormToast(state);
	const errors = state.status === 'error' ? state.fieldErrors : undefined;
	const values = state.values;
	const mode = values?.depositMode ?? defaults.depositMode;
	const checked = (key: 'lateCancelKeepsDeposit' | 'noShowKeepsDeposit') =>
		values ? values[key] === 'on' : defaults[key];

	return (
		<form action={action} className="grid gap-5" noValidate>
			<FormError
				message={state.status === 'error' && !state.fieldErrors ? state.message : undefined}
			/>
			<fieldset className="grid gap-2" aria-describedby="depositMode-error">
				<legend className="mb-1 text-sm font-medium">Take a deposit</legend>
				{chargesEnabled ? null : (
					<p className="text-sm text-muted-foreground">
						Deposits can be turned on once Stripe is set up. Until then, clients book without
						paying.
					</p>
				)}
				{MODES.map((option) => (
					<label key={option.value} className="flex items-start gap-3 rounded-lg border p-3">
						<input
							type="radio"
							name="depositMode"
							value={option.value}
							className="mt-0.5 size-4 accent-primary"
							defaultChecked={mode === option.value}
						/>
						<span className="grid gap-0.5">
							<span className="text-sm font-medium">{option.label}</span>
							<span className="text-sm text-muted-foreground">{option.hint}</span>
						</span>
					</label>
				))}
				{errors?.depositMode ? (
					<p id="depositMode-error" className="text-sm text-destructive">
						{errors.depositMode}
					</p>
				) : null}
			</fieldset>

			<div className="grid gap-3 sm:grid-cols-3">
				<FieldShell
					id="depositType"
					label="Deposit for every booking"
					error={errors?.depositType}
					className="sm:col-span-3"
				>
					<select
						id="depositType"
						name="depositType"
						className={nativeControlClass}
						defaultValue={values?.depositType ?? defaults.depositType}
						{...describedBy('depositType', errors?.depositType)}
					>
						<option value="fixed">A fixed amount</option>
						<option value="percent">A percentage of the price</option>
					</select>
				</FieldShell>
				<TextField
					name="depositAmount"
					label={`Amount (${currency})`}
					inputMode="decimal"
					placeholder="20.00"
					defaultValue={values?.depositAmount ?? defaults.depositAmount}
					error={errors?.depositAmount}
				/>
				<TextField
					name="depositPercent"
					label="Percentage"
					inputMode="numeric"
					placeholder="25"
					defaultValue={values?.depositPercent ?? defaults.depositPercent}
					error={errors?.depositPercent}
				/>
			</div>

			<fieldset className="grid gap-3">
				<legend className="mb-1 text-sm font-medium">Cancellation policy</legend>
				<TextField
					name="freeCancelHours"
					label="Free cancellation until (hours before)"
					hint="Cancelling at least this long before the appointment refunds the deposit."
					inputMode="numeric"
					defaultValue={values?.freeCancelHours ?? defaults.freeCancelHours}
					error={errors?.freeCancelHours}
				/>
				<label className="flex items-start gap-3 rounded-lg border p-3">
					<input
						type="checkbox"
						name="lateCancelKeepsDeposit"
						className="mt-0.5 size-4 accent-primary"
						defaultChecked={checked('lateCancelKeepsDeposit')}
					/>
					<span className="grid gap-0.5">
						<span className="text-sm font-medium">Keep the deposit for late cancellations</span>
						<span className="text-sm text-muted-foreground">
							Otherwise every cancellation by the client is refunded.
						</span>
					</span>
				</label>
				<label className="flex items-start gap-3 rounded-lg border p-3">
					<input
						type="checkbox"
						name="noShowKeepsDeposit"
						className="mt-0.5 size-4 accent-primary"
						defaultChecked={checked('noShowKeepsDeposit')}
					/>
					<span className="grid gap-0.5">
						<span className="text-sm font-medium">Keep the deposit for no-shows</span>
						<span className="text-sm text-muted-foreground">
							Otherwise you&apos;ll be asked to refund it when you mark a no-show.
						</span>
					</span>
				</label>
				<p className="text-sm text-muted-foreground">
					Cancelling the booking yourself always refunds the deposit in full.
				</p>
			</fieldset>

			<SubmitButton className="justify-self-start">Save</SubmitButton>
		</form>
	);
}
