'use client';

import { useRef } from 'react';
import { cn } from '@/lib/utils';

const KEY_STEP: Record<string, (index: number, count: number) => number> = {
	ArrowRight: (i, n) => (i + 1) % n,
	ArrowDown: (i, n) => (i + 1) % n,
	ArrowLeft: (i, n) => (i - 1 + n) % n,
	ArrowUp: (i, n) => (i - 1 + n) % n,
	Home: () => 0,
	End: (_, n) => n - 1,
};

export function StaffTabs({
	staff,
	selectedId,
	onSelect,
	className,
}: {
	staff: { id: string; name: string }[];
	selectedId: string | null;
	onSelect: (id: string) => void;
	className?: string;
}) {
	const tabs = useRef<(HTMLButtonElement | null)[]>([]);
	const selectedIndex = Math.max(
		0,
		staff.findIndex((member) => member.id === selectedId),
	);

	function onKeyDown(event: React.KeyboardEvent, index: number) {
		const step = KEY_STEP[event.key];
		if (!step) return;
		event.preventDefault();
		const next = step(index, staff.length);
		const member = staff[next];
		if (!member) return;
		onSelect(member.id);
		tabs.current[next]?.focus();
	}

	return (
		<div role="tablist" aria-label="Staff" className={cn('flex gap-1 overflow-x-auto', className)}>
			{staff.map((member, index) => {
				const selected = index === selectedIndex;
				return (
					<button
						key={member.id}
						ref={(el) => {
							tabs.current[index] = el;
						}}
						type="button"
						role="tab"
						aria-selected={selected}
						tabIndex={selected ? 0 : -1}
						className={cn(
							'shrink-0 rounded-md border px-3 py-1.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
							selected ? 'bg-accent font-medium' : 'hover:bg-accent/60',
						)}
						onClick={() => onSelect(member.id)}
						onKeyDown={(event) => onKeyDown(event, index)}
					>
						{member.name}
					</button>
				);
			})}
		</div>
	);
}
