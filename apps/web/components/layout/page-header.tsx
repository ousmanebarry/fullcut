import { cn } from '@/lib/utils';

export function PageHeader({
	title,
	description,
	actions,
	eyebrow,
	className,
}: {
	title: React.ReactNode;
	description?: React.ReactNode;
	actions?: React.ReactNode;
	eyebrow?: React.ReactNode;
	className?: string;
}) {
	return (
		<header className={cn('flex flex-wrap items-end justify-between gap-x-4 gap-y-3', className)}>
			<div className="grid min-w-0 gap-1">
				{eyebrow ? <div className="text-sm text-muted-foreground">{eyebrow}</div> : null}
				<h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{title}</h1>
				{description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
			</div>
			{actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
		</header>
	);
}
