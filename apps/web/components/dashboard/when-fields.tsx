'use client';

import { useEffect, useState } from 'react';
import { freeSlotsAction } from '@/app/dashboard/bookings/actions';
import { FieldShell, describedBy, nativeControlClass } from '@/components/forms/fields';
import { Button } from '@/components/ui/button';
import type { DashboardSlot, ServiceOption, StaffOption } from '@/lib/dashboard/types';

export interface When {
	serviceId: string;
	staffId: string;
	date: string;
	time: string;
	overrideHours: boolean;
}

/** Service, staff, date and time, with the engine's open times for that day as quick picks. */
export function WhenFields({
	value,
	onChange,
	services,
	staff,
	isOwner,
	excludeBookingId,
	errors,
	suggestions,
	nowTime,
}: {
	value: When;
	onChange: (next: When) => void;
	services: ServiceOption[];
	staff: StaffOption[];
	isOwner: boolean;
	excludeBookingId?: string;
	errors?: Record<string, string>;
	suggestions?: DashboardSlot[];
	/** Shop-local `HH:mm` now, offered as a "Now" shortcut for walk-ins. */
	nowTime?: string;
}) {
	const set = (patch: Partial<When>) => onChange({ ...value, ...patch });
	const key = `${value.serviceId}|${value.staffId}|${value.date}|${excludeBookingId ?? ''}`;
	const [loaded, setLoaded] = useState<{ key: string; slots: DashboardSlot[] } | null>(null);

	useEffect(() => {
		if (!value.serviceId || !value.staffId || !value.date) return;
		let cancelled = false;
		void freeSlotsAction({
			serviceId: value.serviceId,
			staffId: value.staffId,
			date: value.date,
			excludeBookingId,
		}).then((slots) => {
			if (!cancelled) setLoaded({ key, slots });
		});
		return () => {
			cancelled = true;
		};
	}, [key, value.serviceId, value.staffId, value.date, excludeBookingId]);

	const slots = loaded?.key === key ? loaded.slots : null;
	const picks = suggestions?.length ? suggestions : slots;

	return (
		<div className="grid gap-4">
			<div className="grid gap-3 sm:grid-cols-2">
				<FieldShell id="serviceId" label="Service" error={errors?.serviceId}>
					<select
						id="serviceId"
						className={nativeControlClass}
						value={value.serviceId}
						onChange={(event) => set({ serviceId: event.target.value })}
						{...describedBy('serviceId', errors?.serviceId)}
					>
						{services.map((service) => (
							<option key={service.id} value={service.id}>
								{service.name} ({service.durationMinutes} min)
							</option>
						))}
					</select>
				</FieldShell>
				<FieldShell id="staffId" label="With" error={errors?.staffId}>
					<select
						id="staffId"
						className={nativeControlClass}
						value={value.staffId}
						onChange={(event) => set({ staffId: event.target.value })}
						{...describedBy('staffId', errors?.staffId)}
					>
						{staff.map((member) => (
							<option key={member.id} value={member.id}>
								{member.name}
							</option>
						))}
					</select>
				</FieldShell>
				<FieldShell id="date" label="Date" error={errors?.date}>
					<input
						id="date"
						type="date"
						className={nativeControlClass}
						value={value.date}
						onChange={(event) => set({ date: event.target.value })}
						{...describedBy('date', errors?.date)}
					/>
				</FieldShell>
				<FieldShell id="time" label="Time" error={errors?.time}>
					<div className="flex gap-2">
						<input
							id="time"
							type="time"
							step={300}
							className={nativeControlClass}
							value={value.time}
							onChange={(event) => set({ time: event.target.value })}
							{...describedBy('time', errors?.time)}
						/>
						{nowTime ? (
							<Button
								type="button"
								variant="outline"
								size="lg"
								onClick={() => set({ time: nowTime })}
							>
								Now
							</Button>
						) : null}
					</div>
				</FieldShell>
			</div>

			<div className="grid gap-1.5">
				<span className="text-sm font-medium" id="open-times-label">
					{suggestions?.length ? 'Nearest open times' : 'Open times'}
				</span>
				{picks === null ? (
					<p className="text-sm text-muted-foreground">Loading…</p>
				) : picks.length === 0 ? (
					<p className="text-sm text-muted-foreground">No open times left that day.</p>
				) : (
					<div role="group" aria-labelledby="open-times-label" className="flex flex-wrap gap-1.5">
						{picks.map((slot) => (
							<Button
								key={slot.time}
								type="button"
								size="sm"
								variant={slot.time === value.time ? 'default' : 'outline'}
								aria-pressed={slot.time === value.time}
								className="tabular-nums"
								onClick={() => set({ time: slot.time })}
							>
								{slot.label}
							</Button>
						))}
					</div>
				)}
			</div>

			{isOwner ? (
				<label className="flex items-start gap-2 text-sm">
					<input
						type="checkbox"
						className="mt-0.5 size-4 accent-primary"
						checked={value.overrideHours}
						onChange={(event) => set({ overrideHours: event.target.checked })}
					/>
					<span>
						Override working hours
						<span className="block text-xs text-muted-foreground">
							Allows times outside hours or during time off. Double bookings are still blocked.
						</span>
					</span>
				</label>
			) : null}
		</div>
	);
}
