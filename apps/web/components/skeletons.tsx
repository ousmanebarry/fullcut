import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

function LoadingRegion({
	label,
	className,
	children,
}: {
	label: string;
	className?: string;
	children: React.ReactNode;
}) {
	return (
		<div role="status" aria-busy="true" className={cn('grid gap-3', className)}>
			<span className="sr-only">{label}</span>
			<div aria-hidden="true" className="contents">
				{children}
			</div>
		</div>
	);
}

export function ListSkeleton({
	rows = 4,
	title = false,
	label = 'Loading…',
	className,
}: {
	rows?: number;
	title?: boolean;
	label?: string;
	className?: string;
}) {
	return (
		<LoadingRegion label={label} className={className}>
			{title ? <Skeleton className="mb-2 h-8 w-48" /> : null}
			{Array.from({ length: rows }, (_, i) => (
				<Skeleton key={i} className="h-16 rounded-lg" />
			))}
		</LoadingRegion>
	);
}

export function TableSkeleton({ rows = 8, label = 'Loading…' }: { rows?: number; label?: string }) {
	return (
		<LoadingRegion label={label}>
			<div className="flex flex-wrap gap-3">
				<Skeleton className="h-9 w-64" />
				<Skeleton className="h-9 w-40" />
			</div>
			<div className="grid gap-px overflow-hidden rounded-lg border">
				<Skeleton className="h-10 rounded-none" />
				{Array.from({ length: rows }, (_, i) => (
					<Skeleton key={i} className="h-12 rounded-none opacity-60" />
				))}
			</div>
		</LoadingRegion>
	);
}

export function FormSkeleton({
	fields = 4,
	label = 'Loading…',
}: {
	fields?: number;
	label?: string;
}) {
	return (
		<LoadingRegion label={label} className="gap-5">
			{Array.from({ length: fields }, (_, i) => (
				<div key={i} className="grid gap-2">
					<Skeleton className="h-4 w-28" />
					<Skeleton className="h-9" />
				</div>
			))}
			<Skeleton className="h-9 w-24" />
		</LoadingRegion>
	);
}

export function CalendarSkeleton() {
	return (
		<LoadingRegion label="Loading calendar…" className="gap-4">
			<div className="flex flex-wrap items-center gap-3">
				<Skeleton className="size-9" />
				<Skeleton className="size-9" />
				<Skeleton className="h-7 w-48" />
				<Skeleton className="ml-auto h-9 w-28" />
				<Skeleton className="h-9 w-32" />
			</div>
			<div className="grid grid-cols-[3rem_1fr] gap-2">
				<div className="grid gap-12 pt-10">
					{Array.from({ length: 8 }, (_, i) => (
						<Skeleton key={i} className="h-3 w-8" />
					))}
				</div>
				<Skeleton className="h-[32rem] rounded-lg" />
			</div>
		</LoadingRegion>
	);
}
