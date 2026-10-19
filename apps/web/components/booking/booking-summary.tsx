import { formatCents } from '@/lib/money/format';
import { cn } from '@/lib/utils';

export interface SummaryItem {
	serviceName: string;
	staffName: string;
	when: string;
	durationMinutes: number;
	priceCents: number;
	currency: string;
}

export function BookingSummary({ item, className }: { item: SummaryItem; className?: string }) {
	return (
		<dl className={cn('grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm', className)}>
			<dt className="text-muted-foreground">Service</dt>
			<dd className="font-medium">
				{item.serviceName} · {item.durationMinutes} min
			</dd>
			<dt className="text-muted-foreground">With</dt>
			<dd className="font-medium">{item.staffName}</dd>
			<dt className="text-muted-foreground">When</dt>
			<dd className="font-medium">{item.when}</dd>
			<dt className="text-muted-foreground">Price</dt>
			<dd className="font-medium">{formatCents(item.priceCents, item.currency)}</dd>
		</dl>
	);
}
