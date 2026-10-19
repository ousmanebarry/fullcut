'use client';

import { useEffect } from 'react';

export function ServiceWorkerRegister() {
	useEffect(() => {
		// Dev chunks aren't content-hashed, so caching them would serve stale code.
		if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
		navigator.serviceWorker
			.register('/sw.js', { scope: '/', updateViaCache: 'none' })
			.catch((error: unknown) => console.warn('Service worker registration failed', error));
	}, []);
	return null;
}
