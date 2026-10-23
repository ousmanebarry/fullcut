import { cn } from '@/lib/utils';

export function StepProgress({
	current,
	total,
	className,
}: {
	current: number;
	total: number;
	className?: string;
}) {
	return (
		<div className={cn('grid gap-1.5', className)}>
			<p className="text-xs font-medium text-muted-foreground">
				Step {current} of {total}
			</p>
			<div aria-hidden className="flex gap-1">
				{Array.from({ length: total }, (_, i) => (
					<span
						key={i}
						className={cn('h-1 flex-1 rounded-full', i < current ? 'bg-primary' : 'bg-muted')}
					/>
				))}
			</div>
		</div>
	);
}
