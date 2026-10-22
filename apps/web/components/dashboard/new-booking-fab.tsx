import { PlusIcon } from 'lucide-react';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export const FAB_CLASS =
	'fixed right-4 bottom-[calc(var(--tab-bar-h,0px)+1rem)] z-30 h-14 rounded-full px-5 text-base shadow-lg md:hidden';

/** Phone-only floating "New booking" link, kept above the tab bar. */
export function NewBookingFab({
	href = '/dashboard/calendar?new=1',
	label = 'New booking',
}: {
	href?: string;
	label?: string;
}) {
	return (
		<Link href={href} className={cn(buttonVariants({ size: 'lg' }), FAB_CLASS)}>
			<PlusIcon aria-hidden="true" className="size-5" />
			{label}
		</Link>
	);
}
