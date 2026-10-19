'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';

const DEBOUNCE_MS = 300;

/**
 * Re-renders the current dashboard page when the shop's bookings change (Realtime, filtered by RLS),
 * and whenever the tab regains focus, which also covers Realtime being unavailable.
 */
export function BookingsLive({ shopId }: { shopId: string }) {
	const router = useRouter();

	useEffect(() => {
		const supabase = createClient();
		let timer: ReturnType<typeof setTimeout> | undefined;
		let stopped = false;
		const refresh = () => {
			clearTimeout(timer);
			timer = setTimeout(() => router.refresh(), DEBOUNCE_MS);
		};
		const onVisibility = () => {
			if (document.visibilityState === 'visible') refresh();
		};

		const channel = supabase
			.channel(`bookings:${shopId}`)
			.on(
				'postgres_changes',
				{ event: '*', schema: 'public', table: 'bookings', filter: `shop_id=eq.${shopId}` },
				refresh,
			);
		void supabase.auth.getSession().then(({ data }) => {
			if (stopped) return;
			if (data.session) void supabase.realtime.setAuth(data.session.access_token);
			channel.subscribe();
		});

		window.addEventListener('focus', refresh);
		document.addEventListener('visibilitychange', onVisibility);
		return () => {
			stopped = true;
			clearTimeout(timer);
			window.removeEventListener('focus', refresh);
			document.removeEventListener('visibilitychange', onVisibility);
			void supabase.removeChannel(channel);
		};
	}, [router, shopId]);

	return null;
}
