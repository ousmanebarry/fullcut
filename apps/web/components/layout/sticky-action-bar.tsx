import { cn } from '@/lib/utils';

/** Pinned above the bottom edge (and dashboard tab bar) on phones; a normal row from md up. */
export function StickyActionBar({
	className,
	children,
}: {
	className?: string;
	children: React.ReactNode;
}) {
	return (
		<>
			<div
				className={cn(
					'fixed inset-x-0 bottom-[var(--tab-bar-h,0px)] z-30 flex items-center gap-2 border-t bg-background/95 px-4 pt-3 pb-[calc(0.75rem+var(--bar-safe,env(safe-area-inset-bottom)))] backdrop-blur supports-backdrop-filter:bg-background/80',
					'md:static md:z-auto md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none',
					'[&>*]:flex-1 md:[&>*]:flex-none',
					className,
				)}
			>
				{children}
			</div>
			<div aria-hidden className="h-20 md:hidden" />
		</>
	);
}
