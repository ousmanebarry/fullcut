import { formatCents } from '@/lib/money/format';
import type { RefillMetric } from '@/lib/waitlist/metrics';

/** "Slots recovered" card with its calculation spelled out; reused by the value panel (milestone 13). */
export function RefillMetricCard({ metric, currency }: { metric: RefillMetric; currency: string }) {
	return (
		<div className="grid gap-2 rounded-lg border p-3" data-testid="refill-metric">
			<dl className="grid grid-cols-2 gap-3">
				<div className="grid gap-0.5">
					<dt className="text-sm text-muted-foreground">Slots recovered this month</dt>
					<dd className="text-2xl font-semibold tabular-nums">{metric.slotsRecovered}</dd>
				</div>
				<div className="grid gap-0.5">
					<dt className="text-sm text-muted-foreground">Worth</dt>
					<dd className="text-2xl font-semibold tabular-nums">
						{formatCents(metric.revenueCents, currency)}
					</dd>
				</div>
			</dl>
			<details className="text-sm">
				<summary className="cursor-pointer text-muted-foreground">How is this calculated?</summary>
				<p className="pt-2 text-muted-foreground">
					Slots recovered counts bookings this month that a waitlisted client booked from a text
					after someone else cancelled or moved, not counting ones later cancelled. Worth adds up
					the price of those appointments once they are marked completed.
				</p>
			</details>
		</div>
	);
}
