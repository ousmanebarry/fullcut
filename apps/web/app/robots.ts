import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
	return {
		rules: {
			userAgent: '*',
			allow: '/',
			// Private areas and per-client token links.
			disallow: ['/dashboard', '/onboarding', '/api/', '/auth/', '/b/', '/w/', '/wl/'],
		},
	};
}
