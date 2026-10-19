'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { deleteClientDataAction } from '@/app/dashboard/clients/actions';
import { FormError } from '@/components/forms/fields';
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

/** Owner-only "delete client data": anonymises the client and keeps their booking rows. */
export function DeleteClientButton({ clientId, name }: { clientId: string; name: string }) {
	const [open, setOpen] = useState(false);
	const [message, setMessage] = useState<string>();
	const [pending, startTransition] = useTransition();

	const confirm = () => {
		startTransition(async () => {
			const result = await deleteClientDataAction(clientId);
			if (!result.ok) {
				setMessage(result.message);
				return;
			}
			toast.success(result.message);
			setOpen(false);
		});
	};

	return (
		<AlertDialog
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (!next) setMessage(undefined);
			}}
		>
			<AlertDialogTrigger render={<Button type="button" variant="destructive" />}>
				Delete client data
			</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Delete {name}&apos;s data?</AlertDialogTitle>
					<AlertDialogDescription>
						Their name, phone, email, marketing consent and private notes are removed, along with
						notes on their bookings. Past bookings stay as “Deleted client” so your stats stay
						accurate. This can&apos;t be undone.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<FormError message={message} />
				<AlertDialogFooter>
					<AlertDialogCancel>Keep client</AlertDialogCancel>
					<Button type="button" variant="destructive" onClick={confirm} disabled={pending}>
						{pending ? 'Deleting…' : 'Delete data'}
					</Button>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
