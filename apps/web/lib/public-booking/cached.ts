import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { getPublicShop } from './data';
import type { PublicShop } from './types';

export const publicShopTag = {
	slug: (slug: string) => `public-shop:slug:${slug}`,
	id: (shopId: string) => `public-shop:id:${shopId}`,
};

/** Public page data, cached briefly per slug and invalidated when the shop's settings change. */
export async function getCachedPublicShop(slug: string): Promise<PublicShop | null> {
	'use cache';
	cacheLife('minutes');
	cacheTag(publicShopTag.slug(slug));
	const result = await getPublicShop(createAdminClient(), slug);
	if (!result) return null;
	cacheTag(publicShopTag.id(result.shopId));
	return result.shop;
}
