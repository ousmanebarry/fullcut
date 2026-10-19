import 'server-only';
import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';
import type { Database } from '@/lib/database.types';
import type { Actor } from '@/lib/shop/settings';
import { createClient } from '@/lib/supabase/server';
import { parseShopRole, type MemberRole } from './roles';

export type Shop = Database['public']['Tables']['shops']['Row'];

export interface SessionUser {
	id: string;
	email: string | null;
	name: string | null;
}

export interface ShopContext extends MemberRole {
	userId: string;
	shop: Shop;
}

export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
	const supabase = await createClient();
	const { data, error } = await supabase.auth.getClaims();
	if (error || !data) return null;

	const { claims } = data;
	const name: unknown = claims.user_metadata?.name;
	return {
		id: claims.sub,
		email: typeof claims.email === 'string' ? claims.email : null,
		name: typeof name === 'string' && name.trim() ? name.trim() : null,
	};
});

export async function requireUser(): Promise<SessionUser> {
	const user = await getSessionUser();
	if (!user) redirect('/login');
	return user;
}

// Multi-shop users are not supported yet; the earliest membership wins.
export const getCurrentShop = cache(async (): Promise<ShopContext | null> => {
	const user = await getSessionUser();
	if (!user) return null;

	const supabase = await createClient();
	const { data, error } = await supabase
		.from('shop_members')
		.select('role, staff_id, shop:shops!inner(*)')
		.eq('user_id', user.id)
		.order('created_at', { ascending: true })
		.limit(1)
		.maybeSingle();
	if (error) throw error;
	if (!data) return null;

	return {
		userId: user.id,
		role: parseShopRole(data.role),
		staffId: data.staff_id,
		shop: data.shop,
	};
});

export async function requireShopMember(): Promise<ShopContext> {
	const ctx = await getCurrentShop();
	if (ctx) return ctx;
	redirect((await getSessionUser()) ? '/onboarding' : '/login');
}

export async function requireShopOwner(): Promise<ShopContext> {
	const ctx = await requireShopMember();
	if (ctx.role !== 'owner') notFound();
	return ctx;
}

export function toActor(ctx: ShopContext): Actor {
	return { shopId: ctx.shop.id, role: ctx.role, staffId: ctx.staffId };
}
