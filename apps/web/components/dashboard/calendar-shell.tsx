'use client';

import { ChevronLeftIcon, ChevronRightIcon, PlusIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import { buttonVariants, Button } from '@/components/ui/button';
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from '@/components/ui/sheet';
import type { LayoutColumn } from '@/lib/dashboard/calendar-layout';
import type { CalendarModel } from '@/lib/dashboard/views';
import { cn } from '@/lib/utils';
import { BookingDetails } from './booking-details';
import { CalendarGrid } from './calendar-grid';
import { NewBookingForm } from './new-booking-form';
import { minuteToTime, useNow, zonedMinuteOfDay } from './use-now';

const PATH = '/dashboard/calendar';
const DRAWER_PARAMS = ['booking', 'new', 'time'];

export function CalendarShell({ model, isOwner }: { model: CalendarModel; isOwner: boolean }) {
	const router = useRouter();
	const searchParams = useSearchParams();
	const now = useNow();
	const bookings = useMemo(() => new Map(model.bookings.map((b) => [b.id, b])), [model.bookings]);

	const isWeek = model.view === 'week';
	const staffParam = searchParams.get('staff');
	const phoneStaffId =
		model.staff.find((s) => s.id === staffParam)?.id ?? model.selectedStaffId ?? null;

	const bookingId = searchParams.get('booking');
	const openBooking = bookingId ? bookings.get(bookingId) : undefined;
	const isNew = searchParams.get('new') === '1';

	// Navigation (date, view, week staff) re-renders on the server; drawers only touch the URL.
	const href = (patch: Record<string, string | null>) => {
		const params = new URLSearchParams({ view: model.view, date: model.date });
		if (isWeek && model.selectedStaffId) params.set('staff', model.selectedStaffId);
		for (const [key, value] of Object.entries(patch)) {
			if (value === null) params.delete(key);
			else params.set(key, value);
		}
		return `${PATH}?${params}`;
	};

	const setDrawerParams = (patch: Record<string, string>) => {
		const params = new URLSearchParams(searchParams);
		for (const key of DRAWER_PARAMS) params.delete(key);
		for (const [key, value] of Object.entries(patch)) params.set(key, value);
		window.history.pushState(null, '', `${PATH}?${params}`);
	};
	const closeDrawer = () => setDrawerParams({});

	const createAt = (column: LayoutColumn, time: string) =>
		setDrawerParams({ new: '1', staff: column.staffId, date: column.date, time });

	const nowTime =
		now === null
			? undefined
			: minuteToTime(Math.floor(zonedMinuteOfDay(model.timezone, now) / 5) * 5);

	const newInitial = {
		staffId: (isNew && staffParam) || phoneStaffId || '',
		date: (isNew && searchParams.get('date')) || model.date,
		time: (isNew && searchParams.get('time')) || '',
	};

	return (
		<div className="grid gap-3">
			<div className="flex flex-wrap items-center gap-2">
				<Link
					href={href({ date: model.today })}
					className={buttonVariants({ variant: 'outline', size: 'lg' })}
				>
					Today
				</Link>
				<div className="flex">
					<Link
						href={href({ date: model.prevDate })}
						className={buttonVariants({ variant: 'ghost', size: 'icon-lg' })}
						aria-label={isWeek ? 'Previous week' : 'Previous day'}
					>
						<ChevronLeftIcon aria-hidden="true" />
					</Link>
					<Link
						href={href({ date: model.nextDate })}
						className={buttonVariants({ variant: 'ghost', size: 'icon-lg' })}
						aria-label={isWeek ? 'Next week' : 'Next day'}
					>
						<ChevronRightIcon aria-hidden="true" />
					</Link>
				</div>
				<h1 className="text-lg font-semibold" aria-live="polite">
					{model.title}
				</h1>
				<input
					type="date"
					aria-label="Go to date"
					className="h-9 rounded-lg border border-input bg-transparent px-2 text-sm"
					value={model.date}
					onChange={(event) => {
						if (event.target.value) router.push(href({ date: event.target.value }));
					}}
				/>
				<nav aria-label="Calendar view" className="ml-auto flex rounded-lg border p-0.5">
					{(['day', 'week'] as const).map((view) => (
						<Link
							key={view}
							href={href({
								view,
								staff: view === 'week' ? phoneStaffId : null,
							})}
							aria-current={model.view === view ? 'page' : undefined}
							className={cn(
								'rounded-md px-3 py-1 text-sm capitalize',
								model.view === view ? 'bg-muted font-medium' : 'hover:bg-muted/60',
							)}
						>
							{view}
						</Link>
					))}
				</nav>
				<Button type="button" size="lg" onClick={() => setDrawerParams({ new: '1' })}>
					<PlusIcon aria-hidden="true" />
					New booking
				</Button>
			</div>

			{model.staff.length === 0 ? (
				<p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
					Add a staff member in Settings to start using the calendar.
				</p>
			) : (
				<>
					{isWeek ? (
						<label className="flex items-center gap-2 text-sm">
							<span className="text-muted-foreground">Staff</span>
							<select
								className="h-9 rounded-lg border border-input bg-transparent px-2"
								value={model.selectedStaffId ?? ''}
								onChange={(event) => router.push(href({ staff: event.target.value }))}
							>
								{model.staff.map((member) => (
									<option key={member.id} value={member.id}>
										{member.name}
									</option>
								))}
							</select>
						</label>
					) : model.staff.length > 1 ? (
						<div role="tablist" aria-label="Staff" className="flex gap-1 overflow-x-auto md:hidden">
							{model.staff.map((member) => (
								<button
									key={member.id}
									type="button"
									role="tab"
									aria-selected={member.id === phoneStaffId}
									className={cn(
										'shrink-0 rounded-md border px-3 py-1.5 text-sm',
										member.id === phoneStaffId ? 'bg-muted font-medium' : '',
									)}
									onClick={() => {
										const params = new URLSearchParams(searchParams);
										params.set('staff', member.id);
										window.history.replaceState(null, '', `${PATH}?${params}`);
									}}
								>
									{member.name}
								</button>
							))}
						</div>
					) : null}

					<CalendarGrid
						layout={model.layout}
						bookings={bookings}
						today={model.today}
						timezone={model.timezone}
						phoneColumnKey={isWeek ? null : phoneStaffId}
						onOpenBooking={(id) => setDrawerParams({ booking: id })}
						onCreateAt={createAt}
					/>
				</>
			)}

			<Sheet open={Boolean(bookingId)} onOpenChange={(open) => (open ? null : closeDrawer())}>
				<SheetContent className="w-full overflow-y-auto sm:max-w-md">
					<SheetHeader>
						<SheetTitle>{openBooking ? openBooking.clientName : 'Booking'}</SheetTitle>
						<SheetDescription>
							{openBooking
								? `${openBooking.serviceName} · ${openBooking.timeLabel}`
								: 'This booking is not on the calendar any more.'}
						</SheetDescription>
					</SheetHeader>
					{openBooking ? (
						<BookingDetails
							key={openBooking.id}
							booking={openBooking}
							currency={model.currency}
							services={model.services}
							staff={model.staff}
							isOwner={isOwner}
							onClose={closeDrawer}
						/>
					) : null}
				</SheetContent>
			</Sheet>

			<Sheet open={isNew} onOpenChange={(open) => (open ? null : closeDrawer())}>
				<SheetContent className="w-full overflow-y-auto sm:max-w-lg">
					<SheetHeader>
						<SheetTitle>New booking</SheetTitle>
						<SheetDescription>For a phone call or a walk-in.</SheetDescription>
					</SheetHeader>
					<div className="px-4 pb-6">
						{isNew ? (
							<NewBookingForm
								key={`${newInitial.staffId}|${newInitial.date}|${newInitial.time}`}
								services={model.services}
								staff={model.staff}
								isOwner={isOwner}
								initial={newInitial}
								nowTime={newInitial.date === model.today ? nowTime : undefined}
								onDone={closeDrawer}
							/>
						) : null}
					</div>
				</SheetContent>
			</Sheet>
		</div>
	);
}
