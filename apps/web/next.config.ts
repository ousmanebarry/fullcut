import type { NextConfig } from 'next';

const isDev = process.env.NODE_ENV === 'development';
// Set by Vercel at build time; deploy.yml sets it for --prebuilt production builds.
const vercelEnv = process.env.VERCEL_ENV;

function supabaseOrigins(): string[] {
	const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
	if (!raw) return [];
	const url = new URL(raw);
	const socket = url.protocol === 'https:' ? 'wss:' : 'ws:';
	return [url.origin, `${socket}//${url.host}`];
}

// Vercel's preview toolbar (comments, feedback) only on preview deployments.
const vercelLive =
	vercelEnv === 'preview'
		? {
				script: ['https://vercel.live'],
				connect: ['https://vercel.live', 'wss://ws-us3.pusher.com'],
				img: ['https://vercel.live', 'https://vercel.com'],
				frame: ['https://vercel.live'],
				style: ['https://vercel.live'],
				font: ['https://vercel.live', 'https://assets.vercel.com'],
			}
		: { script: [], connect: [], img: [], frame: [], style: [], font: [] };

// No nonces: they need every page dynamic, which conflicts with cacheComponents/PPR.
const csp = [
	"default-src 'self'",
	`script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''} ${vercelLive.script.join(' ')}`,
	`style-src 'self' 'unsafe-inline' ${vercelLive.style.join(' ')}`,
	`img-src 'self' data: blob: ${vercelLive.img.join(' ')}`,
	`font-src 'self' ${vercelLive.font.join(' ')}`,
	`connect-src 'self' ${[...supabaseOrigins(), ...vercelLive.connect].join(' ')}`,
	`frame-src 'self' ${vercelLive.frame.join(' ')}`,
	"worker-src 'self'",
	"manifest-src 'self'",
	"object-src 'none'",
	"base-uri 'self'",
	"form-action 'self'",
	"frame-ancestors 'none'",
	...(vercelEnv ? ['upgrade-insecure-requests'] : []),
]
	.map((directive) => directive.trim())
	.join('; ');

const securityHeaders = [
	{ key: 'Content-Security-Policy', value: csp },
	{ key: 'X-Frame-Options', value: 'DENY' },
	{ key: 'X-Content-Type-Options', value: 'nosniff' },
	{ key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
	{
		key: 'Permissions-Policy',
		value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()',
	},
	...(vercelEnv === 'production'
		? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }]
		: []),
];

const nextConfig: NextConfig = {
	/* config options here */
	cacheComponents: true,
	partialPrefetching: true,
	poweredByHeader: false,
	turbopack: {
		rules: {
			'*.css': {
				loaders: ['@tailwindcss/turbopack'],
				as: '*.css',
			},
		},
	},
	async headers() {
		// When several entries set the same key, the later entry wins.
		return [
			{
				source: '/:path*',
				headers: securityHeaders,
			},
			{
				source: '/sw.js',
				headers: [
					{ key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
					{ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
					{ key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self'" },
				],
			},
			{
				// Manage links carry a secret token in the path: never leak it via Referer or search engines.
				source: '/b/:token*',
				headers: [
					{ key: 'Referrer-Policy', value: 'no-referrer' },
					{ key: 'X-Robots-Tag', value: 'noindex, nofollow' },
					{ key: 'Cache-Control', value: 'private, no-store' },
				],
			},
			{
				// Waitlist view/leave (/wl) and offer claim (/w) links are secret in the same way.
				source: '/:prefix(w|wl)/:token*',
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
