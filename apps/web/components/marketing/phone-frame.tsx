import { BatteryFullIcon, SignalIcon, WifiIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/** A CSS iPhone shell (bezel, Dynamic Island, side buttons) around a phone-sized screenshot. */
export function PhoneFrame({
	className,
	children,
}: {
	className?: string;
	children: React.ReactNode;
}) {
	return (
		<div className={cn('relative mx-auto w-full max-w-70', className)}>
			<span
				aria-hidden
				className="absolute top-[16%] -left-[3px] h-7 w-[3px] rounded-l-sm bg-neutral-700"
			/>
			<span
				aria-hidden
				className="absolute top-[24%] -left-[3px] h-12 w-[3px] rounded-l-sm bg-neutral-700"
			/>
			<span
				aria-hidden
				className="absolute top-[33%] -left-[3px] h-12 w-[3px] rounded-l-sm bg-neutral-700"
			/>
			<span
				aria-hidden
				className="absolute top-[27%] -right-[3px] h-18 w-[3px] rounded-r-sm bg-neutral-700"
			/>
			<div className="rounded-[3rem] bg-neutral-900 p-2.5 shadow-2xl ring-1 ring-neutral-700 dark:ring-neutral-500">
				<div className="relative overflow-hidden rounded-[2.4rem] bg-white">
					<div
						aria-hidden
						className="relative flex h-9 items-center justify-between px-7 text-[0.7rem] font-semibold text-black"
					>
						<span>9:41</span>
						<span className="absolute top-2 left-1/2 h-[1.4rem] w-[4.75rem] -translate-x-1/2 rounded-full bg-black" />
						<span className="flex items-center gap-1">
							<SignalIcon className="size-3" />
							<WifiIcon className="size-3" />
							<BatteryFullIcon className="size-4" />
						</span>
					</div>
					{children}
					<span
						aria-hidden
						className="absolute bottom-1.5 left-1/2 h-1 w-24 -translate-x-1/2 rounded-full bg-black/80"
					/>
				</div>
			</div>
		</div>
	);
}
