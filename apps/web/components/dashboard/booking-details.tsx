'use client';

import { PhoneIcon, Undo2Icon } from 'lucide-react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { cancelBookingAction, updateBookingAction } from '@/app/dashboard/bookings/actions';
import { FormError, TextField } from '@/components/forms/fields';
import { Button, buttonVariants } from '@/components/ui/button';
import { formatCents } from '@/lib/money/format';
import {
	availableActions,
	SOURCE_LABELS,
	type DashboardBooking,
	type DashboardSlot,
	type ServiceOption,
	type StaffOption,
} from '@/lib/dashboard/types';
import { StatusBadge } from './booking-list';
import { BookingMessages } from './booking-messages';
import { OutcomeButtons, undoOutcome } from './outcome-buttons';
import { useNow } from './use-now';
import { WhenFields, type When } from './when-fields';

type Mode = 'view' | 'edit' | 'cancel';

export function BookingDetails({
	booking,
	currency,
	services,
	staff,
	isOwner,
	onClose,
}: {
	booking: DashboardBooking;
	currency: string;
	services: ServiceOption[];
	staff: StaffOption[];
	isOwner: boolean;
	onClose: () => void;
}) {
	const now = useNow();
	const [mode, setMode] = useState<Mode>('view');
	const actions = now === null ? [] : availableActions(booking, now);

	return (
		<div className="grid gap-5 px-4 pb-6">
			<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
				<dt className="text-muted-foreground">Status</dt>
				<dd>
					<StatusBadge status={booking.status} />
				</dd>
				<dt className="text-muted-foreground">Client</dt>
				<dd className="flex flex-wrap items-center gap-2">
					<span className="font-medium">{booking.clientName}</span>
					{booking.clientPhone ? (
						<a
							href={`tel:${booking.clientPhone}`}
							className={buttonVariants({ variant: 'outline', size: 'sm' })}
						>
							<PhoneIcon aria-hidden="true" />
							{booking.clientPhone}
						</a>
					) : null}
				</dd>
				<dt className="text-muted-foreground">When</dt>
				<dd>
					{booking.dateLabel}, {booking.timeLabel}
				</dd>
				<dt className="text-muted-foreground">Service</dt>
				<dd>{booking.serviceName}</dd>
				<dt className="text-muted-foreground">With</dt>
				<dd>{booking.staffName}</dd>
				<dt className="text-muted-foreground">Price</dt>
				<dd>{formatCents(booking.priceCents, currency)}</dd>
				<dt className="text-muted-foreground">Source</dt>
				<dd>{SOURCE_LABELS[booking.source] ?? booking.source}</dd>
				{booking.notes ? (
					<>
						<dt className="text-muted-foreground">Notes</dt>
						<dd className="whitespace-pre-line">{booking.notes}</dd>
					</>
				) : null}
				{booking.cancelReason ? (
					<>
						<dt className="text-muted-foreground">Reason</dt>
						<dd>{booking.cancelReason}</dd>
					</>
				) : null}
				<dt className="text-muted-foreground">Booked</dt>
				<dd>{booking.createdLabel}</dd>
			</dl>

			<BookingMessages
				bookingId={booking.id}
				version={`${booking.status}:${booking.startsAtMs}:${booking.staffId}`}
			/>

			{mode === 'edit' ? (
				<EditForm
					booking={booking}
					services={services}
					staff={staff}
					isOwner={isOwner}
					onCancel={() => setMode('view')}
					onDone={() => setMode('view')}
				/>
			) : mode === 'cancel' ? (
				<CancelForm booking={booking} onBack={() => setMode('view')} onDone={onClose} />
			) : (
				<div className="flex flex-wrap gap-2">
					{actions.includes('markCompleted') ? (
						<OutcomeButtons bookingId={booking.id} clientName={booking.clientName} />
					) : null}
					{actions.includes('undoOutcome') ? (
						<Button type="button" variant="outline" onClick={() => void undoOutcome(booking.id)}>
							<Undo2Icon aria-hidden="true" />
							Undo outcome
						</Button>
					) : null}
					{actions.includes('edit') ? (
						<Button type="button" variant="outline" onClick={() => setMode('edit')}>
							Reschedule or change
						</Button>
					) : null}
					{actions.includes('cancel') ? (
						<Button type="button" variant="destructive" onClick={() => setMode('cancel')}>
							Cancel booking
						</Button>
					) : null}
				</div>
			)}
		</div>
	);
}

function EditForm({
	booking,
	services,
	staff,
	isOwner,
	onCancel,
	onDone,
}: {
	booking: DashboardBooking;
	services: ServiceOption[];
	staff: StaffOption[];
	isOwner: boolean;
	onCancel: () => void;
	onDone: () => void;
}) {
	const [when, setWhen] = useState<When>({
		serviceId: booking.serviceId,
		staffId: booking.staffId,
		date: booking.date,
		time: booking.time,
		overrideHours: false,
	});
	const [error, setError] = useState<{
		message?: string;
		fields?: Record<string, string>;
		suggestions?: DashboardSlot[];
	}>({});
	const [pending, startTransition] = useTransition();
	// The booking's own service stays selectable even if it has since been retired.
	const serviceOptions = services.some((s) => s.id === booking.serviceId)
		? services
		: [
				{ id: booking.serviceId, name: booking.serviceName, durationMinutes: 0, priceCents: 0 },
				...services,
			];
	const staffOptions = staff.some((s) => s.id === booking.staffId)
		? staff
		: [{ id: booking.staffId, name: booking.staffName }, ...staff];

	const submit = (event: React.FormEvent) => {
		event.preventDefault();
		startTransition(async () => {
			const result = await updateBookingAction({ bookingId: booking.id, ...when });
			if (result.ok) {
				toast.success(result.message);
				onDone();
				return;
			}
			setError({
				message: result.message,
				fields: result.fieldErrors,
				suggestions: result.suggestions,
			});
		});
	};

	return (
		<form onSubmit={submit} className="grid gap-4 rounded-lg border p-3" noValidate>
			<h3 className="font-medium">Reschedule or change</h3>
			<FormError message={error.message} />
			<WhenFields
				value={when}
				onChange={(next) => {
					setWhen(next);
					setError((current) => ({ ...current, suggestions: undefined }));
				}}
				services={serviceOptions}
				staff={staffOptions}
				isOwner={isOwner}
				excludeBookingId={booking.id}
				errors={error.fields}
				suggestions={error.suggestions}
			/>
			<div className="flex gap-2">
				<Button type="submit" size="lg" disabled={pending}>
					{pending ? 'Saving…' : 'Save changes'}
				</Button>
				<Button type="button" size="lg" variant="ghost" onClick={onCancel}>
					Back
				</Button>
			</div>
		</form>
	);
}

function CancelForm({
	booking,
	onBack,
	onDone,
}: {
	booking: DashboardBooking;
	onBack: () => void;
	onDone: () => void;
}) {
	const [reason, setReason] = useState('');
	const [message, setMessage] = useState<string>();
	const [pending, startTransition] = useTransition();

	const submit = (event: React.FormEvent) => {
		event.preventDefault();
		startTransition(async () => {
			const result = await cancelBookingAction({ bookingId: booking.id, reason });
			if (result.ok) {
				toast.success(result.message);
				onDone();
			} else {
				setMessage(result.message);
			}
		});
	};

	return (
		<form onSubmit={submit} className="grid gap-3 rounded-lg border p-3" noValidate>
			<h3 className="font-medium">Cancel {booking.clientName}’s booking?</h3>
			<FormError message={message} />
			<TextField
				name="reason"
				label="Reason (optional)"
				maxLength={200}
				value={reason}
				onChange={(event) => setReason(event.target.value)}
			/>
			<div className="flex gap-2">
				<Button type="submit" size="lg" variant="destructive" disabled={pending}>
					{pending ? 'Cancelling…' : 'Cancel booking'}
				</Button>
				<Button type="button" size="lg" variant="ghost" onClick={onBack}>
					Keep it
				</Button>
			</div>
		</form>
	);
}
