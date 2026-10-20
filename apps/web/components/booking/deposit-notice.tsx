import { formatCents } from '@/lib/money/format';
import { describeCancellationPolicy, type CancellationPolicy } from '@/lib/payments/policy';
import { cn } from '@/lib/utils';

/** The deposit, the cancellation policy and Fullcut's (zero) fee, shown before paying and after. */
export function DepositNotice({
	depositCents,
	priceCents,
	currency,
	policy,
	paid = false,
	className,
}: {
	depositCents: number;
	priceCents: number;
	currency: string;
	policy: CancellationPolicy;
	paid?: boolean;
	className?: string;
}) {
	const rest = priceCents - depositCents;
	return (
		<section
			aria-label="Deposit and cancellation policy"
			className={cn('grid gap-2 rounded-lg border p-3 text-sm', className)}
		>
			<p>
				<span className="font-medium">
					{paid ? 'Deposit paid' : 'Deposit due now'}: {formatCents(depositCents, currency)}
				</span>
				{rest > 0 ? (
					<span className="text-muted-foreground">
						{' '}
						· {formatCents(rest, currency)} {paid ? 'left to pay' : 'paid'} at the shop
					</span>
				) : null}
			</p>
			<ul className="grid gap-1 text-muted-foreground">
				{describeCancellationPolicy(policy, depositCents, currency).map((line) => (
					<li key={line}>{line}</li>
				))}
			</ul>
			<p className="text-muted-foreground">
				No Fullcut fee. {paid ? 'Paid' : 'Paid securely'} through Stripe to the shop.
			</p>
		</section>
	);
}
