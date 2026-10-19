'use client';

import { CheckIcon, UserXIcon } from 'lucide-react';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { markOutcomeAction, undoOutcomeAction } from '@/app/dashboard/bookings/actions';
import { Button } from '@/components/ui/button';
import type { Outcome } from '@/lib/dashboard/types';

export async function undoOutcome(bookingId: string) {
	const result = await undoOutcomeAction(bookingId);
	if (result.ok) toast.success(result.message);
	else toast.error(result.message);
}

/** One-tap completed / no-show, with an Undo in the confirmation toast. */
export function OutcomeButtons({
	bookingId,
	clientName,
	compact = false,
}: {
	bookingId: string;
	clientName: string;
	compact?: boolean;
}) {
	const [pending, startTransition] = useTransition();

	const mark = (outcome: Outcome) =>
		startTransition(async () => {
			const result = await markOutcomeAction(bookingId, outcome);
			if (!result.ok) {
				toast.error(result.message);
				return;
			}
			toast.success(`${clientName}: ${result.message}`, {
				action: { label: 'Undo', onClick: () => void undoOutcome(bookingId) },
			});
		});

	return (
		<div className="flex shrink-0 gap-1" role="group" aria-label={`Outcome for ${clientName}`}>
			<Button
				type="button"
				size={compact ? 'icon-xs' : 'sm'}
				variant="outline"
				disabled={pending}
				aria-label={`Mark ${clientName} completed`}
				onClick={(event) => {
					event.stopPropagation();
					mark('completed');
				}}
			>
				<CheckIcon aria-hidden="true" />
				{compact ? null : 'Done'}
			</Button>
			<Button
				type="button"
				size={compact ? 'icon-xs' : 'sm'}
				variant="destructive"
				disabled={pending}
				aria-label={`Mark ${clientName} as no-show`}
				onClick={(event) => {
					event.stopPropagation();
					mark('no_show');
				}}
			>
				<UserXIcon aria-hidden="true" />
				{compact ? null : 'No-show'}
			</Button>
		</div>
	);
}
