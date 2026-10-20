import type { SupabaseClient } from '@supabase/supabase-js';
import type { MemberRole } from '@/lib/auth/roles';
import { canEditSchedule, isOwner } from '@/lib/auth/roles';
import type { Result } from '@/lib/booking/types';
import type { Database } from '@/lib/database.types';
import { toUserFacingError, type UserFacingError } from '@/lib/db/errors';
import type { Instant } from '@/lib/time';
import { instantToIso } from '@/lib/time';
import { hoursToRules, type WeeklyHours } from './hours';
import type { MessageSettingsInput, ServiceInput } from './schemas';

// Mutations behind the settings pages. Callers pass a user-scoped client (RLS applies) and an actor
// derived on the server; every write is also filtered by the actor's shop_id.

export type Db = SupabaseClient<Database>;

export interface Actor extends MemberRole {
	shopId: string;
}

export type MutationResult = Result<null, UserFacingError>;

export const OWNER_ONLY: UserFacingError = { message: 'Only the shop owner can change this.' };
export const NOT_FOUND: UserFacingError = { message: 'That item no longer exists.' };
const OWN_SCHEDULE_ONLY: UserFacingError = { message: 'You can only change your own schedule.' };

const ok: MutationResult = { ok: true, value: null };
const fail = (error: UserFacingError): MutationResult => ({ ok: false, error });

function settle(
	error: { code?: string; message?: string } | null,
	rows: unknown[] | null,
): MutationResult {
	if (error) return fail(toUserFacingError(error));
	return rows && rows.length > 0 ? ok : fail(NOT_FOUND);
}

export interface ShopProfileInput {
	name: string;
	slug: string;
	timezone: string;
	currency: string;
	phone: string | null;
	address: string | null;
	aboutText: string | null;
	logoUrl: string | null;
}

export async function updateShopProfile(
	db: Db,
	actor: Actor,
	input: ShopProfileInput,
): Promise<MutationResult> {
	if (!isOwner(actor)) return fail(OWNER_ONLY);
	const { data, error } = await db
		.from('shops')
		.update({
			name: input.name,
			slug: input.slug,
			timezone: input.timezone,
			currency: input.currency,
			phone: input.phone,
			address: input.address,
			about_text: input.aboutText,
			logo_url: input.logoUrl,
		})
		.eq('id', actor.shopId)
		.select('id');
	return settle(error, data);
}

export interface BookingRulesInput {
	slotStepMinutes: number;
	minLeadMinutes: number;
	maxHorizonDays: number;
	cancelCutoffHours: number;
	maxActiveBookingsPerPhone: number;
	bookingPageEnabled: boolean;
}

export async function updateBookingRules(
	db: Db,
	actor: Actor,
	input: BookingRulesInput,
): Promise<MutationResult> {
	if (!isOwner(actor)) return fail(OWNER_ONLY);
	const { data, error } = await db
		.from('shops')
		.update({
			slot_step_minutes: input.slotStepMinutes,
			min_lead_minutes: input.minLeadMinutes,
			max_horizon_days: input.maxHorizonDays,
			cancel_cutoff_hours: input.cancelCutoffHours,
			max_active_bookings_per_phone: input.maxActiveBookingsPerPhone,
			booking_page_enabled: input.bookingPageEnabled,
		})
		.eq('id', actor.shopId)
		.select('id');
	return settle(error, data);
}

export async function updateMessageSettings(
	db: Db,
	actor: Actor,
	input: MessageSettingsInput,
): Promise<MutationResult> {
	if (!isOwner(actor)) return fail(OWNER_ONLY);
	const { data, error } = await db
		.from('shops')
		.update({
			sms_confirmation_enabled: input.confirmationEnabled,
			sms_reminder_enabled: input.reminderEnabled,
			sms_confirm_request_enabled: input.confirmRequestEnabled,
			sms_rescheduled_enabled: input.rescheduledEnabled,
			sms_cancelled_enabled: input.cancelledEnabled,
			sms_reminder_lead_hours: input.reminderLeadHours,
			sms_sign_off: input.signOff,
		})
		.eq('id', actor.shopId)
		.select('id');
	return settle(error, data);
}

export async function createStaff(
	db: Db,
	actor: Actor,
	displayName: string,
): Promise<MutationResult> {
	if (!isOwner(actor)) return fail(OWNER_ONLY);
	const { data, error } = await db
		.from('staff')
		.insert({ shop_id: actor.shopId, display_name: displayName })
		.select('id');
	return settle(error, data);
}

export async function updateStaff(
	db: Db,
	actor: Actor,
	staffId: string,
	patch: { displayName?: string; active?: boolean },
): Promise<MutationResult> {
	if (!isOwner(actor)) return fail(OWNER_ONLY);
	const { data, error } = await db
		.from('staff')
		.update({ display_name: patch.displayName, active: patch.active })
		.eq('shop_id', actor.shopId)
		.eq('id', staffId)
		.select('id');
	return settle(error, data);
}

export async function createService(
	db: Db,
	actor: Actor,
	input: ServiceInput,
): Promise<MutationResult> {
	if (!isOwner(actor)) return fail(OWNER_ONLY);
	const { data: last, error: lastError } = await db
		.from('services')
		.select('sort_order')
		.eq('shop_id', actor.shopId)
		.order('sort_order', { ascending: false })
		.limit(1)
		.maybeSingle();
	if (lastError) return fail(toUserFacingError(lastError));

	const { data, error } = await db
		.from('services')
		.insert({
			shop_id: actor.shopId,
			name: input.name,
			duration_minutes: input.durationMinutes,
			buffer_minutes: input.bufferMinutes,
			price_cents: input.price,
			deposit_cents: input.deposit,
			sort_order: (last?.sort_order ?? -1) + 1,
		})
		.select('id');
	return settle(error, data);
}

export async function updateService(
	db: Db,
	actor: Actor,
	serviceId: string,
	patch: Partial<ServiceInput> & { active?: boolean },
): Promise<MutationResult> {
	if (!isOwner(actor)) return fail(OWNER_ONLY);
	const { data, error } = await db
		.from('services')
		.update({
			name: patch.name,
			duration_minutes: patch.durationMinutes,
			buffer_minutes: patch.bufferMinutes,
			price_cents: patch.price,
			deposit_cents: patch.deposit,
			active: patch.active,
		})
		.eq('shop_id', actor.shopId)
		.eq('id', serviceId)
		.select('id');
	return settle(error, data);
}

export async function moveService(
	db: Db,
	actor: Actor,
	serviceId: string,
	direction: 'up' | 'down',
): Promise<MutationResult> {
	if (!isOwner(actor)) return fail(OWNER_ONLY);
	const { data: services, error } = await db
		.from('services')
		.select('id')
		.eq('shop_id', actor.shopId)
		.order('sort_order')
		.order('created_at');
	if (error) return fail(toUserFacingError(error));

	const ids = services.map((s) => s.id);
	const index = ids.indexOf(serviceId);
	if (index === -1) return fail(NOT_FOUND);
	const target = direction === 'up' ? index - 1 : index + 1;
	if (target < 0 || target >= ids.length) return ok;

	[ids[index], ids[target]] = [ids[target] as string, ids[index] as string];
	const { error: reorderError } = await db.rpc('reorder_services', {
		p_shop_id: actor.shopId,
		p_service_ids: ids,
	});
	return reorderError ? fail(toUserFacingError(reorderError)) : ok;
}

export async function replaceStaffHours(
	db: Db,
	actor: Actor,
	staffId: string,
	hours: WeeklyHours,
): Promise<MutationResult> {
	if (!canEditSchedule(actor, staffId)) return fail(OWN_SCHEDULE_ONLY);
	const { data: staff, error: staffError } = await db
		.from('staff')
		.select('id')
		.eq('shop_id', actor.shopId)
		.eq('id', staffId)
		.maybeSingle();
	if (staffError) return fail(toUserFacingError(staffError));
	if (!staff) return fail(NOT_FOUND);

	const { error } = await db.rpc('replace_availability_rules', {
		p_staff_id: staffId,
		p_rules: hoursToRules(hours),
	});
	return error ? fail(toUserFacingError(error)) : ok;
}

export async function addTimeOff(
	db: Db,
	actor: Actor,
	input: { staffId: string; startsAt: Instant; endsAt: Instant; reason: string | null },
): Promise<MutationResult> {
	if (!canEditSchedule(actor, input.staffId)) return fail(OWN_SCHEDULE_ONLY);
	const { data, error } = await db
		.from('time_off')
		.insert({
			shop_id: actor.shopId,
			staff_id: input.staffId,
			starts_at: instantToIso(input.startsAt),
			ends_at: instantToIso(input.endsAt),
			reason: input.reason,
		})
		.select('id');
	return settle(error, data);
}

export async function deleteTimeOff(
	db: Db,
	actor: Actor,
	timeOffId: string,
): Promise<MutationResult> {
	let query = db.from('time_off').delete().eq('shop_id', actor.shopId).eq('id', timeOffId);
	if (!isOwner(actor)) {
		if (!actor.staffId) return fail(OWN_SCHEDULE_ONLY);
		query = query.eq('staff_id', actor.staffId);
	}
	const { data, error } = await query.select('id');
	return settle(error, data);
}
