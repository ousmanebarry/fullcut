'use client';

import { ArrowDownIcon, ArrowUpIcon } from 'lucide-react';
import { useActionState } from 'react';
import { TextField } from '@/components/forms/fields';
import { SubmitButton, useFormToast } from '@/components/forms/form-controls';
import { Button } from '@/components/ui/button';
import { idleState, type FormState } from '@/lib/forms';
import { centsToDollarInput } from '@/lib/money';
import { addService, editService, reorderService, setServiceActive } from './actions';

interface ServiceValues {
	name: string;
	durationMinutes: string;
	bufferMinutes: string;
	price: string;
	deposit: string;
}

function ServiceFields({
	idPrefix,
	currency,
	state,
	defaults,
}: {
	idPrefix: string;
	currency: string;
	state: FormState;
	defaults: ServiceValues;
}) {
	const errors = state.status === 'error' ? state.fieldErrors : undefined;
	const value = (key: keyof ServiceValues) => state.values?.[key] ?? defaults[key];
	return (
		<>
			<TextField
				name="name"
				id={`${idPrefix}-name`}
				label="Name"
				defaultValue={value('name')}
				error={errors?.name}
				className="sm:col-span-4"
			/>
			<TextField
				name="durationMinutes"
				id={`${idPrefix}-duration`}
				label="Minutes"
				inputMode="numeric"
				defaultValue={value('durationMinutes')}
				error={errors?.durationMinutes}
			/>
			<TextField
				name="bufferMinutes"
				id={`${idPrefix}-buffer`}
				label="Buffer"
				hint="Cleanup minutes"
				inputMode="numeric"
				defaultValue={value('bufferMinutes')}
				error={errors?.bufferMinutes}
			/>
			<TextField
				name="price"
				id={`${idPrefix}-price`}
				label={`Price (${currency})`}
				inputMode="decimal"
				placeholder="35.00"
				defaultValue={value('price')}
				error={errors?.price}
				className="sm:col-span-2"
			/>
			<TextField
				name="deposit"
				id={`${idPrefix}-deposit`}
				label={`Deposit (${currency})`}
				hint="Used when deposits are set per service in Payments."
				inputMode="decimal"
				placeholder="0.00"
				defaultValue={value('deposit')}
				error={errors?.deposit}
				className="sm:col-span-2"
			/>
		</>
	);
}

export function AddServiceForm({ currency }: { currency: string }) {
	const [state, action] = useActionState(addService, idleState);
	useFormToast(state);
	return (
		<form action={action} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-4" noValidate>
			<h2 className="font-medium sm:col-span-4">Add a service</h2>
			<ServiceFields
				idPrefix="new-service"
				currency={currency}
				state={state}
				defaults={{
					name: '',
					durationMinutes: '30',
					bufferMinutes: '0',
					price: '',
					deposit: '',
				}}
			/>
			<SubmitButton pendingLabel="Adding…" className="sm:col-span-4 sm:justify-self-start">
				Add service
			</SubmitButton>
		</form>
	);
}

export interface ServiceRowData {
	id: string;
	name: string;
	duration_minutes: number;
	buffer_minutes: number;
	price_cents: number;
	deposit_cents: number;
	active: boolean;
}

export function ServiceRow({
	service,
	currency,
	isFirst,
	isLast,
}: {
	service: ServiceRowData;
	currency: string;
	isFirst: boolean;
	isLast: boolean;
}) {
	const [editState, edit] = useActionState(editService, idleState);
	const [toggleState, toggle] = useActionState(setServiceActive, idleState);
	const [moveState, move] = useActionState(reorderService, idleState);
	useFormToast(editState);
	useFormToast(toggleState);
	useFormToast(moveState.status === 'error' ? moveState : idleState);

	return (
		<li className="grid gap-3 rounded-lg border p-3">
			<div className="flex items-center justify-between gap-2">
				<p className="font-medium">
					{service.name}
					{service.active ? null : (
						<span className="ml-2 text-sm font-normal text-muted-foreground">(hidden)</span>
					)}
				</p>
				<form action={move} className="flex gap-1">
					<input type="hidden" name="serviceId" value={service.id} />
					<Button
						type="submit"
						name="direction"
						value="up"
						variant="ghost"
						size="icon-lg"
						disabled={isFirst}
						aria-label={`Move ${service.name} up`}
					>
						<ArrowUpIcon />
					</Button>
					<Button
						type="submit"
						name="direction"
						value="down"
						variant="ghost"
						size="icon-lg"
						disabled={isLast}
						aria-label={`Move ${service.name} down`}
					>
						<ArrowDownIcon />
					</Button>
				</form>
			</div>
			<form action={edit} className="grid gap-3 sm:grid-cols-4" noValidate>
				<input type="hidden" name="serviceId" value={service.id} />
				<ServiceFields
					idPrefix={`service-${service.id}`}
					currency={currency}
					state={editState}
					defaults={{
						name: service.name,
						durationMinutes: String(service.duration_minutes),
						bufferMinutes: String(service.buffer_minutes),
						price: centsToDollarInput(service.price_cents),
						deposit: service.deposit_cents ? centsToDollarInput(service.deposit_cents) : '',
					}}
				/>
				<SubmitButton variant="outline" className="sm:col-span-4 sm:justify-self-start">
					Save
				</SubmitButton>
			</form>
			<form action={toggle}>
				<input type="hidden" name="serviceId" value={service.id} />
				<input type="hidden" name="active" value={String(!service.active)} />
				<SubmitButton
					variant={service.active ? 'destructive' : 'secondary'}
					pendingLabel="Updating…"
				>
					{service.active ? 'Hide from booking' : 'Make bookable'}
				</SubmitButton>
			</form>
		</li>
	);
}
