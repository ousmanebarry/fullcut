'use client';

import type { PublicSlot } from '@/lib/public-booking/types';

export function SlotSuggestions({
	suggestions,
	onPick,
}: {
	suggestions: readonly PublicSlot[];
	onPick: (slot: PublicSlot) => void;
}) {
	return (
		<section aria-label="Nearest open times" className="grid gap-2">
			<p className="text-sm font-medium">Nearest open times</p>
			<ul className="flex flex-wrap gap-2">
				{suggestions.map((slot) => (
					<li key={`${slot.startsAt}-${slot.staffId}`}>
						<button
							type="button"
							onClick={() => onPick(slot)}
							className="min-h-11 rounded-lg border bg-background px-3 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
						>
							{slot.label}
						</button>
					</li>
				))}
			</ul>
		</section>
	);
}
