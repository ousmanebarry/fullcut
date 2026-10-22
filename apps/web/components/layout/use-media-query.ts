'use client';

import { useSyncExternalStore } from 'react';

/** False during SSR and the first client render, so layouts must also work without it. */
export function useMediaQuery(query: string): boolean {
	return useSyncExternalStore(
		(onChange) => {
			const list = matchMedia(query);
			list.addEventListener('change', onChange);
			return () => list.removeEventListener('change', onChange);
		},
		() => matchMedia(query).matches,
		() => false,
	);
}

export const MOBILE_QUERY = '(max-width: 767px)';
