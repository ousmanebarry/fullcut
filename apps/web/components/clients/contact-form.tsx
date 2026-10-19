'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { mergeClientsAction, updateClientAction } from '@/app/dashboard/clients/actions';
import { FormError, TextField } from '@/components/forms/fields';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import type { DuplicateClient } from '@/lib/clients/types';

interface Contact {
	name: string;
	phone: string;
	email: string;
}

/** Editable contact details; a number another client already has offers the owner a merge. */
export function ClientContactForm({
	client,
	isOwner,
}: {
	client: {
		id: string;
		name: string;
		phone: string | null;
		email: string | null;
		totalBookings: number;
	};
	isOwner: boolean;
}) {
	const [values, setValues] = useState<Contact>({
		name: client.name,
		phone: client.phone ?? '',
		email: client.email ?? '',
	});
	const [error, setError] = useState<{ message?: string; fields?: Record<string, string> }>({});
	const [duplicate, setDuplicate] = useState<DuplicateClient | null>(null);
	const [mergeOpen, setMergeOpen] = useState(false);
	const [pending, startTransition] = useTransition();

	const set = (key: keyof Contact) => (event: React.ChangeEvent<HTMLInputElement>) =>
		setValues((current) => ({ ...current, [key]: event.target.value }));

	const submit = (event: React.FormEvent) => {
		event.preventDefault();
		startTransition(async () => {
			const result = await updateClientAction({ clientId: client.id, ...values });
			if (result.ok) {
				setError({});
				setDuplicate(null);
				toast.success(result.message);
				return;
			}
			setError({ message: result.message, fields: result.fieldErrors });
			setDuplicate(isOwner ? (result.duplicate ?? null) : null);
			setMergeOpen(isOwner && Boolean(result.duplicate));
		});
	};

	return (
		<>
			<form onSubmit={submit} className="grid gap-3" noValidate>
				<FormError message={error.message} />
				<TextField
					name="name"
					label="Name"
					value={values.name}
					onChange={set('name')}
					error={error.fields?.name}
					autoComplete="off"
					required
				/>
				<TextField
					name="phone"
					label="Phone"
					type="tel"
					value={values.phone}
					onChange={set('phone')}
					error={error.fields?.phone}
					autoComplete="off"
				/>
				<TextField
					name="email"
					label="Email"
					type="email"
					value={values.email}
					onChange={set('email')}
					error={error.fields?.email}
					autoComplete="off"
				/>
				<div className="flex flex-wrap gap-2">
					<Button type="submit" disabled={pending}>
						{pending ? 'Saving…' : 'Save'}
					</Button>
					{duplicate ? (
						<Button type="button" variant="outline" onClick={() => setMergeOpen(true)}>
							Merge with {duplicate.name}
						</Button>
					) : null}
				</div>
			</form>
			{duplicate && mergeOpen ? (
				<MergeDialog
					key={duplicate.id}
					current={client}
					duplicate={duplicate}
					contact={values}
					onClose={() => setMergeOpen(false)}
				/>
			) : null}
		</>
	);
}

function MergeDialog({
	current,
	duplicate,
	contact,
	onClose,
}: {
	current: { id: string; name: string; totalBookings: number };
	duplicate: DuplicateClient;
	contact: Contact;
	onClose: () => void;
}) {
	const router = useRouter();
	const [keepId, setKeepId] = useState(
		duplicate.totalBookings > current.totalBookings ? duplicate.id : current.id,
	);
	const [message, setMessage] = useState<string>();
	const [pending, startTransition] = useTransition();
	const mergeId = keepId === current.id ? duplicate.id : current.id;

	const options = [
		{ id: current.id, label: `${current.name} (this client)`, bookings: current.totalBookings },
		{ id: duplicate.id, label: duplicate.name, bookings: duplicate.totalBookings },
	];

	const merge = () => {
		startTransition(async () => {
			const result = await mergeClientsAction({ keepId, mergeId, ...contact });
			if (!result.ok) {
				setMessage(result.message);
				return;
			}
			toast.success(result.message);
			onClose();
			if (result.redirectTo) router.replace(result.redirectTo);
		});
	};

	return (
		<Dialog open onOpenChange={(open) => (open ? null : onClose())}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Merge duplicate clients?</DialogTitle>
					<DialogDescription>
						{duplicate.name} already has {duplicate.phone}. Merging moves every booking and note to
						the client you keep, fills in any missing details from the other, saves the details you
						entered, and removes the other record. This can&apos;t be undone.
					</DialogDescription>
				</DialogHeader>
				<FormError message={message} />
				<fieldset className="grid gap-2">
					<legend className="mb-1 text-sm font-medium">Keep</legend>
					{options.map((option) => (
						<label key={option.id} className="flex items-center gap-2 text-sm">
							<input
								type="radio"
								name="keep"
								value={option.id}
								checked={keepId === option.id}
								onChange={() => setKeepId(option.id)}
								className="accent-primary"
							/>
							{option.label} · {option.bookings === 1 ? '1 booking' : `${option.bookings} bookings`}
						</label>
					))}
				</fieldset>
				<DialogFooter>
					<Button type="button" variant="outline" onClick={onClose}>
						Cancel
					</Button>
					<Button type="button" onClick={merge} disabled={pending}>
						{pending ? 'Merging…' : 'Merge clients'}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
