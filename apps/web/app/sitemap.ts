import type { MetadataRoute } from 'next';
import { getDemoShopSlug } from '@/lib/env';

export default function sitemap(): MetadataRoute.Sitemap {
	const base = process.env.SITE_URL || 'https://fullcut.ca';
	const url = (path: string) => new URL(path, base).href;
	const demoShopSlug = getDemoShopSlug();
	return [
		{ url: url('/'), changeFrequency: 'monthly', priority: 1 },
		{ url: url('/signup'), changeFrequency: 'yearly', priority: 0.5 },
		{ url: url('/login'), changeFrequency: 'yearly', priority: 0.3 },
		// Real shops' pages are theirs to promote; only the demo shop is listed.
		...(demoShopSlug
			? [{ url: url(`/${demoShopSlug}`), changeFrequency: 'weekly' as const, priority: 0.6 }]
			: []),
	];
}
