'use server';

import { refresh } from 'next/cache';
import { z } from 'zod';
import { requireShopMember, toActor } from '@/lib/auth/session';
import {
	changeBookingStatus,
	createManualBooking,
	extendManageLink,
	markOutcomes,
	OUTCOME_EVENTS,
	updateBooking,
	type DashboardError,
} from '@/lib/dashboard/mutations';
import { searchClients, staffFreeSlots, toDashboardSlot } from '@/lib/dashboard/queries';
import {
	bulkOutcomeSchema,
	cancelSchema,
	clientSearchSchema,
	editBookingSchema,
	freeSlotsSchema,
	idSchema,
	manualBookingSchema,
	outcomeSchema,
} from '@/lib/dashboard/schemas';
import type { ActionResult, ClientMatch, DashboardSlot } from '@/lib/dashboard/types';
import { fieldErrorsFrom } from '@/lib/forms';
import { bookingMessageHistory } from '@/lib/messaging/queries';
import type { BookingMessageHistory } from '@/lib/messaging/types';
import { loadActiveServices, toBookingShop } from '@/lib/public-booking/data';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import type { Instant } from '@/lib/time';

// Any shop member may manage bookings; the shop always comes from the session, never the request.
async function bookingContext() {
	const ctx = await requireShopMember();
	return {
		actor: toActor(ctx),
		shop: toBookingShop(ctx.shop),
		db: await createClient(),
		now: Date.now() as Instant,
	};
}

const INVALID: ActionResult = {
	ok: false,
	message: 'Something went wrong. Refresh and try again.',
};

function failed(error: DashboardError): ActionResult {
	return {
		ok: false,
		message: error.message,
		fieldErrors: error.field ? { [error.field]: error.message } : undefined,
		suggestions: error.suggestions,
	};
}

function invalid(error: z.ZodError): ActionResult {
	return {
		ok: false,
		message: 'Check the highlighted fields.',
		fieldErrors: fieldErrorsFrom(error),
	};
}

function done(message: string): ActionResult {
	refresh();
	return { ok: true, message };
}

export async function markOutcomeAction(bookingId: string, outcome: string): Promise<ActionResult> {
	const id = idSchema.safeParse(bookingId);
	const parsedOutcome = outcomeSchema.safeParse(outcome);
	if (!id.success || !parsedOutcome.success) return INVALID;
	const { actor, shop, db, now } = await bookingContext();
	const result = await changeBookingStatus(
		db,
		actor,
		shop,
		id.data,
		OUTCOME_EVENTS[parsedOutcome.data],
		now,
	);
	if (!result.ok) return failed(result.error);
	return done(parsedOutcome.data === 'completed' ? 'Marked completed.' : 'Marked as no-show.');
}

export async function undoOutcomeAction(bookingId: string): Promise<ActionResult> {
	const id = idSchema.safeParse(bookingId);
	if (!id.success) return INVALID;
	const { actor, shop, db, now } = await bookingContext();
	const result = await changeBookingStatus(db, actor, shop, id.data, 'undoOutcome', now);
	return result.ok ? done('Outcome undone.') : failed(result.error);
}

export async function cancelBookingAction(input: unknown): Promise<ActionResult> {
	const parsed = cancelSchema.safeParse(input);
	if (!parsed.success) return invalid(parsed.error);
	const { actor, shop, db, now } = await bookingContext();
	const result = await changeBookingStatus(
		db,
		actor,
		shop,
		parsed.data.bookingId,
		'cancel',
		now,
		parsed.data.reason,
	);
	return result.ok ? done('Booking cancelled.') : failed(result.error);
}

export async function bulkMarkAction(input: unknown): Promise<ActionResult> {
	const parsed = bulkOutcomeSchema.safeParse(input);
	if (!parsed.success) return INVALID;
	const { actor, shop, db, now } = await bookingContext();
	const { marked, failed: skipped } = await markOutcomes(
		db,
		actor,
		shop,
		parsed.data.bookingIds,
		parsed.data.outcome,
		now,
	);
	if (marked === 0) return { ok: false, message: 'Nothing was marked. Refresh and try again.' };
	const noun = marked === 1 ? 'booking' : 'bookings';
	return done(
		skipped > 0 ? `Marked ${marked} ${noun}; ${skipped} had changed.` : `Marked ${marked} ${noun}.`,
	);
}

export async function updateBookingAction(input: unknown): Promise<ActionResult> {
	const parsed = editBookingSchema.safeParse(input);
	if (!parsed.success) return invalid(parsed.error);
	const { actor, shop, db, now } = await bookingContext();
	const result = await updateBooking(db, actor, shop, parsed.data, now);
	if (!result.ok) return failed(result.error);
	await extendManageLink(
		createAdminClient(),
		shop.id,
		parsed.data.bookingId,
		result.value.startsAt,
	);
	return done('Booking updated.');
}

export async function createBookingAction(input: unknown): Promise<ActionResult> {
	const parsed = manualBookingSchema.safeParse(input);
	if (!parsed.success) return invalid(parsed.error);
	const { actor, shop, db, now } = await bookingContext();
	const result = await createManualBooking(db, actor, shop, parsed.data, now);
	return result.ok ? done('Booking added.') : failed(result.error);
}

export async function freeSlotsAction(input: unknown): Promise<DashboardSlot[]> {
	const parsed = freeSlotsSchema.safeParse(input);
	if (!parsed.success) return [];
	const { shop, db, now } = await bookingContext();
	const service = (await loadActiveServices(db, shop.id)).find(
		(s) => s.id === parsed.data.serviceId,
	);
	if (!service) return [];
	const slots = await staffFreeSlots(
		db,
		shop,
		service,
		[parsed.data.staffId],
		parsed.data.date,
		now,
		parsed.data.excludeBookingId,
	);
	return slots.map((s) => toDashboardSlot(s.startsAt, shop.timezone));
}

export async function searchClientsAction(query: unknown): Promise<ClientMatch[]> {
	const parsed = clientSearchSchema.safeParse(query);
	if (!parsed.success) return [];
	const { shop, db } = await bookingContext();
	return searchClients(db, shop.id, parsed.data);
}

export async function bookingMessagesAction(
	bookingId: unknown,
): Promise<BookingMessageHistory | null> {
	const id = idSchema.safeParse(bookingId);
	if (!id.success) return null;
	const { shop, db } = await bookingContext();
	return bookingMessageHistory(db, shop.id, id.data, shop.timezone);
}
