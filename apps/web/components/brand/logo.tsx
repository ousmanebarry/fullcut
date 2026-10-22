import Link from 'next/link';
import { cn } from '@/lib/utils';

export function LogoMark({ className }: { className?: string }) {
	return (
		<span
			aria-hidden
			className={cn(
				'flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground',
				className,
			)}
		>
			F
		</span>
	);
}

export function Logo({ href = '/', className }: { href?: string; className?: string }) {
	return (
		<Link
			href={href}
			className={cn('flex items-center gap-2 font-semibold tracking-tight', className)}
		>
			<LogoMark />
			Fullcut
		</Link>
	);
}
