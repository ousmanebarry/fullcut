'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';

const DISMISSED_KEY = 'fullcut:install-hint-dismissed';

type Platform = 'ios' | 'prompt' | 'none';

interface BeforeInstallPromptEvent extends Event {
	prompt(): Promise<void>;
	userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function detectPlatform(): Platform {
	const standalone =
		window.matchMedia('(display-mode: standalone)').matches ||
		(navigator as Navigator & { standalone?: boolean }).standalone === true;
	if (standalone || !window.matchMedia('(pointer: coarse)').matches) return 'none';
	if (localStorage.getItem(DISMISSED_KEY)) return 'none';
	const ua = navigator.userAgent;
	// iPadOS reports itself as a Mac; touch support gives it away.
	const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
	return ios ? 'ios' : 'prompt';
}

const subscribeNoop = () => () => {};

/** First-run hint on phones and tablets to add the dashboard to the home screen. */
export function InstallHint() {
	const platform = useSyncExternalStore<Platform>(subscribeNoop, detectPlatform, () => 'none');
	const [dismissed, setDismissed] = useState(false);
	const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);

	useEffect(() => {
		function onBeforeInstallPrompt(event: Event) {
			event.preventDefault();
			setInstallEvent(event as BeforeInstallPromptEvent);
		}
		window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
		return () => window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
	}, []);

	function dismiss() {
		localStorage.setItem(DISMISSED_KEY, '1');
		setDismissed(true);
	}

	async function install() {
		if (!installEvent) return;
		await installEvent.prompt();
		await installEvent.userChoice;
		setInstallEvent(null);
		dismiss();
	}

	if (dismissed || platform === 'none') return null;
	if (platform === 'prompt' && !installEvent) return null;

	return (
		<aside
			aria-label="Install Fullcut"
			className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border bg-muted/50 p-3 text-sm"
		>
			<p className="flex-1">
				{platform === 'ios' ? (
					<>
						Add Fullcut to your Home Screen: tap <strong>Share</strong>, then{' '}
						<strong>Add to Home Screen</strong>.
					</>
				) : (
					'Install Fullcut for quick, full-screen access to your calendar.'
				)}
			</p>
			<div className="flex gap-2">
				{platform === 'prompt' && <Button onClick={install}>Install</Button>}
				<Button variant="ghost" onClick={dismiss}>
					Not now
				</Button>
			</div>
		</aside>
	);
}
