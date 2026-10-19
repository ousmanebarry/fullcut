import 'server-only';
import type { ShopContext } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';

export async function listStaff(ctx: ShopContext) {
	const db = await createClient();
	const { data, error } = await db
		.from('staff')
		.select('id, display_name, active')
		.eq('shop_id', ctx.shop.id)
		.order('created_at')
		.order('id');
	if (error) throw error;
	return data;
}

/** Staff whose schedule the member may edit: all active staff for owners, only their own profile for staff. */
export async function editableStaff(ctx: ShopContext) {
	const staff = await listStaff(ctx);
	return staff.filter((s) => (ctx.role === 'owner' ? s.active : s.id === ctx.staffId));
}

export async function listServices(ctx: ShopContext) {
	const db = await createClient();
	const { data, error } = await db
		.from('services')
		.select('id, name, duration_minutes, buffer_minutes, price_cents, active, sort_order')
		.eq('shop_id', ctx.shop.id)
		.order('sort_order')
		.order('created_at');
	if (error) throw error;
	return data;
}

export async function listRules(ctx: ShopContext, staffId: string) {
	const db = await createClient();
	const { data, error } = await db
		.from('availability_rules')
		.select('weekday, start_time, end_time')
		.eq('shop_id', ctx.shop.id)
		.eq('staff_id', staffId);
	if (error) throw error;
	return data;
}

export async function listUpcomingTimeOff(ctx: ShopContext, now: Date) {
	const db = await createClient();
	const { data, error } = await db
		.from('time_off')
		.select('id, staff_id, starts_at, ends_at, reason')
		.eq('shop_id', ctx.shop.id)
		.gt('ends_at', now.toISOString())
		.order('starts_at')
		.limit(100);
	if (error) throw error;
	return data;
}

export async function setupProgress(ctx: ShopContext) {
	const db = await createClient();
	const [services, staff, rules] = await Promise.all([
		db
			.from('services')
			.select('id', { count: 'exact', head: true })
			.eq('shop_id', ctx.shop.id)
			.eq('active', true),
		db
			.from('staff')
			.select('id', { count: 'exact', head: true })
			.eq('shop_id', ctx.shop.id)
			.eq('active', true),
		db
			.from('availability_rules')
			.select('id', { count: 'exact', head: true })
			.eq('shop_id', ctx.shop.id),
	]);
	for (const result of [services, staff, rules]) if (result.error) throw result.error;
	return { services: services.count ?? 0, staff: staff.count ?? 0, rules: rules.count ?? 0 };
}
