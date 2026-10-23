'use client';

import { ChevronLeftIcon, ChevronRightIcon, PlusIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import { nativeControlClass } from '@/components/forms/fields';
import { MOBILE_QUERY, useMediaQuery } from '@/components/layout/use-media-query';
import { buttonVariants, Button } from '@/components/ui/button';
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from '@/components/ui/sheet';
import type { LayoutColumn } from '@/lib/dashboard/calendar-layout';
import type { ClientMatch } from '@/lib/dashboard/types';
import type { CalendarModel } from '@/lib/dashboard/views';
import { cn } from '@/lib/utils';
import { BookingDetails } from './booking-details';
import { CalendarAgenda } from './calendar-agenda';
import { CalendarGrid } from './calendar-grid';
import { FAB_CLASS } from './new-booking-fab';
import { NewBookingForm } from './new-booking-form';
import { StaffTabs } from './staff-tabs';
import { minuteToTime, useNow, zonedMinuteOfDay } from './use-now';

const PATH = '/dashboard/calendar';
const DRAWER_PARAMS = ['booking', 'new', 'time', 'client', 'service'];
const PHONE_LAYOUTS = [
	{ id: 'agenda', label: 'List' },
	{ id: 'grid', label: 'Grid' },
	{ id: 'week', label: 'Week' },
] as const;

export function CalendarShell({
	model,
	isOwner,
	prefillClient = null,
}: {
	model: CalendarModel;
	isOwner: boolean;
	prefillClient?: ClientMatch | null;
}) {
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
	const gridOnPhone = searchParams.get('layout') === 'grid';
	const agendaColumn = isWeek
		? null
		: (model.layout.columns.find((c) => c.key === phoneStaffId) ?? model.layout.columns[0] ?? null);
	const isPhone = useMediaQuery(MOBILE_QUERY);
	const sheetSide = isPhone ? 'bottom' : 'right';
	const sheetClass = (desktopWidth: string) =>
		isPhone
			? 'max-h-[92dvh] overflow-y-auto rounded-t-2xl pb-safe'
			: cn('w-full overflow-y-auto', desktopWidth);

	// Navigation (date, view, week staff) re-renders on the server; drawers only touch the URL.
	const href = (patch: Record<string, string | null>) => {
		const params = new URLSearchParams({ view: model.view, date: model.date });
		if (isWeek && model.selectedStaffId) params.set('staff', model.selectedStaffId);
		if (gridOnPhone) params.set('layout', 'grid');
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
		serviceId: (isNew && searchParams.get('service')) || '',
		client:
			isNew && prefillClient && searchParams.get('client') === prefillClient.id
				? prefillClient
				: null,
	};

	return (
		<div className="grid gap-4">
			<div className="flex flex-wrap items-center gap-2">
				<div className="flex w-full items-center gap-1 md:w-auto">
					<Link
						href={href({ date: model.prevDate })}
						className={buttonVariants({ variant: 'ghost', size: 'icon-lg' })}
						aria-label={isWeek ? 'Previous week' : 'Previous day'}
					>
						<ChevronLeftIcon aria-hidden="true" />
					</Link>
					<h1
						className="min-w-0 flex-1 truncate text-center text-lg font-semibold tracking-tight md:min-w-56 md:text-xl"
						aria-live="polite"
					>
						{model.title}
					</h1>
					<Link
						href={href({ date: model.nextDate })}
						className={buttonVariants({ variant: 'ghost', size: 'icon-lg' })}
						aria-label={isWeek ? 'Next week' : 'Next day'}
					>
						<ChevronRightIcon aria-hidden="true" />
					</Link>
				</div>
				<Link
					href={href({ date: model.today })}
					className={buttonVariants({ variant: 'outline', size: 'lg' })}
				>
					Today
				</Link>
				<input
					type="date"
					aria-label="Go to date"
					className={cn(nativeControlClass, 'w-auto')}
					value={model.date}
					onChange={(event) => {
						if (event.target.value) router.push(href({ date: event.target.value }));
					}}
				/>
				<nav
					aria-label="Calendar layout"
					className="ml-auto flex rounded-lg border p-0.5 md:hidden"
				>
					{PHONE_LAYOUTS.map((option) => {
						const current =
							option.id === 'week' ? isWeek : !isWeek && (option.id === 'grid') === gridOnPhone;
						return (
							<Link
								key={option.id}
								href={href(
									option.id === 'week'
										? { view: 'week', staff: phoneStaffId, layout: null }
										: {
												view: 'day',
												staff: null,
												layout: option.id === 'grid' ? 'grid' : null,
											},
								)}
								aria-current={current ? 'page' : undefined}
								className={cn(
									'flex min-h-9 items-center rounded-md px-3 text-sm pointer-coarse:min-h-10',
									current ? 'bg-primary/10 font-medium text-primary' : 'hover:bg-accent/60',
								)}
							>
								{option.label}
							</Link>
						);
					})}
				</nav>
				<nav aria-label="Calendar view" className="ml-auto hidden rounded-lg border p-0.5 md:flex">
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
								model.view === view
									? 'bg-primary/10 font-medium text-primary'
									: 'hover:bg-accent/60',
							)}
						>
							{view}
						</Link>
					))}
				</nav>
				<Button
					type="button"
					size="lg"
					className="hidden md:inline-flex"
					onClick={() => setDrawerParams({ new: '1' })}
				>
					<PlusIcon aria-hidden="true" />
					New booking
				</Button>
				<Button
					type="button"
					size="lg"
					className={FAB_CLASS}
					onClick={() => setDrawerParams({ new: '1' })}
				>
					<PlusIcon aria-hidden="true" className="size-5" />
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
						<StaffTabs
							className="md:hidden"
							staff={model.staff}
							selectedId={phoneStaffId}
							onSelect={(id) => {
								const params = new URLSearchParams(searchParams);
								params.set('staff', id);
								window.history.replaceState(null, '', `${PATH}?${params}`);
							}}
						/>
					) : null}

					{agendaColumn ? (
						<CalendarAgenda
							className={cn('md:hidden', gridOnPhone && 'hidden')}
							column={agendaColumn}
							bookings={bookings}
							today={model.today}
							timezone={model.timezone}
							onOpenBooking={(id) => setDrawerParams({ booking: id })}
							onCreateAt={createAt}
						/>
					) : null}
					<div className={cn(agendaColumn && !gridOnPhone && 'hidden md:block')}>
						<CalendarGrid
							layout={model.layout}
							bookings={bookings}
							today={model.today}
							timezone={model.timezone}
							phoneColumnKey={isWeek ? null : phoneStaffId}
							onOpenBooking={(id) => setDrawerParams({ booking: id })}
							onCreateAt={createAt}
						/>
					</div>
				</>
			)}

			<Sheet open={Boolean(bookingId)} onOpenChange={(open) => (open ? null : closeDrawer())}>
				<SheetContent side={sheetSide} className={sheetClass('sm:max-w-md')}>
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
				<SheetContent side={sheetSide} className={sheetClass('sm:max-w-lg')}>
					<SheetHeader>
						<SheetTitle>New booking</SheetTitle>
						<SheetDescription>For a phone call or a walk-in.</SheetDescription>
					</SheetHeader>
					<div className="px-4 pb-6">
						{isNew ? (
							<NewBookingForm
								key={`${newInitial.staffId}|${newInitial.date}|${newInitial.time}|${newInitial.client?.id ?? ''}`}
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
