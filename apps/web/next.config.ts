import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
	/* config options here */
	cacheComponents: true,
	partialPrefetching: true,
	turbopack: {
		rules: {
			'*.css': {
				loaders: ['@tailwindcss/turbopack'],
				as: '*.css',
			},
		},
	},
	async headers() {
		return [
			{
				// Manage links carry a secret token in the path: never leak it via Referer or search engines.
				source: '/b/:token*',
				headers: [
					{ key: 'Referrer-Policy', value: 'no-referrer' },
					{ key: 'X-Robots-Tag', value: 'noindex, nofollow' },
					{ key: 'Cache-Control', value: 'private, no-store' },
				],
			},
		];
	},
};

export default nextConfig;
