// Fullcut service worker: offline fallback and hashed static assets only.
// Never cache API responses, RSC payloads, server actions or booking data.
const STATIC_CACHE = 'fullcut-static-v1';
const OFFLINE_URL = '/offline.html';
const PRECACHE = [OFFLINE_URL, '/icons/icon-192.png'];

self.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(STATIC_CACHE)
			.then((cache) => cache.addAll(PRECACHE))
			.then(() => self.skipWaiting()),
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) =>
				Promise.all(
					keys
						.filter((key) => key.startsWith('fullcut-') && key !== STATIC_CACHE)
						.map((key) => caches.delete(key)),
				),
			)
			.then(() => self.clients.claim()),
	);
});

self.addEventListener('fetch', (event) => {
	const { request } = event;
	if (request.method !== 'GET') return;
	const url = new URL(request.url);
	if (url.origin !== self.location.origin) return;

	if (request.mode === 'navigate') {
		event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
		return;
	}

	// Content-hashed by Next.js, so a cached copy is never stale.
	if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
		event.respondWith(
			caches.open(STATIC_CACHE).then(async (cache) => {
				const cached = await cache.match(request);
				if (cached) return cached;
				const response = await fetch(request);
				if (response.ok) await cache.put(request, response.clone());
				return response;
			}),
		);
	}
});
