'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FormError } from '@/components/forms/fields';
import { Button } from '@/components/ui/button';
import { leaveWaitlist } from '@/lib/public-booking/client-api';
import { describeWindows, type EntryStatus, type TimeWindow } from '@/lib/waitlist/types';

export interface ManageWaitlistProps {
	token: string;
	status: EntryStatus;
	shop: { slug: string; name: string; phone: string | null };
	serviceName: string;
	staffName: string | null;
	earliestLabel: string;
	latestLabel: string;
	timeWindows: TimeWindow[];
}

const STATUS_LABELS: Record<EntryStatus, string> = {
	active: 'On the waitlist',
	booked: 'Booked from the waitlist',
	expired: 'Expired',
	cancelled: 'Left the waitlist',
};

export function ManageWaitlist(props: ManageWaitlistProps) {
	const { token, status, shop } = props;
	const router = useRouter();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function leave() {
		setBusy(true);
		const result = await leaveWaitlist(token);
		setBusy(false);
		if (result.ok) router.refresh();
		else setError(result.error.message);
	}

	return (
		<div className="grid gap-5">
			<header className="grid gap-1">
				<p className="text-sm text-muted-foreground">{shop.name}</p>
				<h1 className="text-2xl font-semibold">Your waitlist spot</h1>
				<p role="status" className="text-sm font-medium">
					{STATUS_LABELS[status]}
				</p>
			</header>

			<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-lg border bg-muted/40 p-3 text-sm">
				<dt className="text-muted-foreground">Service</dt>
				<dd>{props.serviceName}</dd>
				<dt className="text-muted-foreground">Stylist</dt>
				<dd>{props.staffName ?? 'Anyone'}</dd>
				<dt className="text-muted-foreground">Dates</dt>
				<dd>
					{props.earliestLabel} to {props.latestLabel}
				</dd>
				<dt className="text-muted-foreground">Times</dt>
				<dd>{describeWindows(props.timeWindows)}</dd>
			</dl>

			{status === 'active' ? (
				<div className="grid gap-2">
					<FormError message={error ?? undefined} />
					<p className="text-sm text-muted-foreground">
						We&apos;ll text you when a spot opens that matches. You can leave at any time.
					</p>
					<Button
						type="button"
						variant="outline"
						size="lg"
						className="h-11 justify-self-start"
						disabled={busy}
						onClick={leave}
					>
						{busy ? 'Leaving…' : 'Leave the waitlist'}
					</Button>
				</div>
			) : (
				<a
					href={`/${shop.slug}`}
					className="inline-flex h-11 items-center justify-self-start rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
				>
					Book an appointment
				</a>
			)}
		</div>
	);
}
