'use client';

import { XIcon } from 'lucide-react';
import { useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { createBookingAction, searchClientsAction } from '@/app/dashboard/bookings/actions';
import { FormError, TextAreaField, TextField } from '@/components/forms/fields';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import type {
	ClientMatch,
	DashboardSlot,
	ManualSource,
	ServiceOption,
	StaffOption,
} from '@/lib/dashboard/types';
import { WhenFields, type When } from './when-fields';

const SEARCH_DELAY_MS = 250;

/** Phone or walk-in booking made by staff. */
export function NewBookingForm({
	services,
	staff,
	isOwner,
	initial,
	nowTime,
	onDone,
}: {
	services: ServiceOption[];
	staff: StaffOption[];
	isOwner: boolean;
	initial: {
		staffId: string;
		date: string;
		time: string;
		serviceId?: string;
		client?: ClientMatch | null;
	};
	nowTime?: string;
	onDone: () => void;
}) {
	const [source, setSource] = useState<ManualSource>('phone');
	const [client, setClient] = useState<ClientMatch | null>(initial.client ?? null);
	const [query, setQuery] = useState('');
	const [matches, setMatches] = useState<ClientMatch[]>([]);
	const [name, setName] = useState('');
	const [phone, setPhone] = useState('');
	const [notes, setNotes] = useState('');
	const [when, setWhen] = useState<When>({
		serviceId: services.some((s) => s.id === initial.serviceId)
			? (initial.serviceId ?? '')
			: (services[0]?.id ?? ''),
		staffId: staff.some((s) => s.id === initial.staffId) ? initial.staffId : (staff[0]?.id ?? ''),
		date: initial.date,
		time: initial.time,
		overrideHours: false,
	});
	const [error, setError] = useState<{
		message?: string;
		fields?: Record<string, string>;
		suggestions?: DashboardSlot[];
	}>({});
	const [pending, startTransition] = useTransition();
	const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const search = (text: string) => {
		setQuery(text);
		if (searchTimer.current) clearTimeout(searchTimer.current);
		if (text.trim().length < 2) {
			setMatches([]);
			return;
		}
		searchTimer.current = setTimeout(() => {
			void searchClientsAction(text).then(setMatches);
		}, SEARCH_DELAY_MS);
	};

	const pick = (match: ClientMatch) => {
		setClient(match);
		setMatches([]);
		setQuery('');
	};

	const submit = (event: React.FormEvent) => {
		event.preventDefault();
		// A search with no match doubles as the new client's name or number.
		const queryIsPhone = /^[\d\s()+.-]+$/.test(query.trim());
		startTransition(async () => {
			const result = await createBookingAction({
				source,
				clientId: client?.id,
				clientName: client ? undefined : name || (queryIsPhone ? '' : query),
				phone: client ? undefined : phone || (queryIsPhone ? query : ''),
				notes,
				...when,
			});
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

	if (services.length === 0 || staff.length === 0) {
		return (
			<p className="text-sm text-muted-foreground">
				Add at least one service and one staff member before taking bookings.
			</p>
		);
	}

	return (
		<form onSubmit={submit} className="grid gap-4" noValidate>
			<FormError message={error.message} />

			<fieldset className="grid gap-1.5">
				<legend className="mb-1.5 text-sm font-medium">Booked by</legend>
				<div className="grid grid-cols-2 gap-2 sm:flex sm:gap-2">
					{(
						[
							['phone', 'Phone'],
							['walk_in', 'Walk-in'],
						] as const
					).map(([value, label]) => (
						<label
							key={value}
							className="flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm hover:bg-accent/50 has-checked:border-primary has-checked:bg-primary/10 sm:min-h-9"
						>
							<input
								type="radio"
								name="source"
								value={value}
								className="size-4 accent-primary"
								checked={source === value}
								onChange={() => setSource(value)}
							/>
							{label}
						</label>
					))}
				</div>
			</fieldset>

			{client ? (
				<div className="grid gap-1.5">
					<Label>Client</Label>
					<div className="flex items-center justify-between gap-2 rounded-lg border p-2 text-sm">
						<span>
							<span className="font-medium">{client.name}</span>
							{client.phone ? (
								<span className="text-muted-foreground"> · {client.phone}</span>
							) : null}
						</span>
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							aria-label="Choose a different client"
							onClick={() => setClient(null)}
						>
							<XIcon aria-hidden="true" />
						</Button>
					</div>
				</div>
			) : (
				<>
					<div className="grid gap-1.5">
						<TextField
							name="clientSearch"
							label="Client"
							placeholder="Search by name or phone"
							autoComplete="off"
							value={query}
							onChange={(event) => search(event.target.value)}
							error={error.fields?.clientName}
							hint="Pick an existing client, or fill in the details below for a new one."
						/>
						{matches.length > 0 ? (
							<ul className="grid rounded-lg border" aria-label="Matching clients">
								{matches.map((match) => (
									<li key={match.id}>
										<button
											type="button"
											className="flex w-full justify-between gap-2 px-3 py-3 text-left text-sm hover:bg-accent sm:py-2"
											onClick={() => pick(match)}
										>
											<span className="font-medium">{match.name}</span>
											<span className="text-muted-foreground">{match.phone ?? 'No phone'}</span>
										</button>
									</li>
								))}
							</ul>
						) : null}
					</div>
					<div className="grid gap-3 sm:grid-cols-2">
						<TextField
							name="clientName"
							label="New client name"
							autoComplete="off"
							value={name}
							onChange={(event) => setName(event.target.value)}
						/>
						<TextField
							name="phone"
							label={source === 'phone' ? 'Phone' : 'Phone (optional)'}
							type="tel"
							autoComplete="off"
							value={phone}
							onChange={(event) => setPhone(event.target.value)}
							error={error.fields?.phone}
						/>
					</div>
				</>
			)}

			<WhenFields
				value={when}
				onChange={(next) => {
					setWhen(next);
					setError((current) => ({ ...current, suggestions: undefined }));
				}}
				services={services}
				staff={staff}
				isOwner={isOwner}
				errors={error.fields}
				suggestions={error.suggestions}
				nowTime={source === 'walk_in' ? nowTime : undefined}
			/>

			<TextAreaField
				name="notes"
				label="Notes (optional)"
				rows={2}
				value={notes}
				onChange={(event) => setNotes(event.target.value)}
				error={error.fields?.notes}
			/>

			<Button
				type="submit"
				size="lg"
				disabled={pending}
				className="w-full sm:w-auto sm:justify-self-start"
			>
				{pending ? 'Booking…' : 'Add booking'}
			</Button>
		</form>
	);
}
