'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { signInAsDemo } from '@/app/(auth)/actions';
import { FormError } from '@/components/forms/fields';
import { SubmitButton } from '@/components/forms/form-controls';
import { buttonVariants } from '@/components/ui/button';
import { idleState } from '@/lib/forms';

export function DemoEntry({ shopSlug }: { shopSlug: string }) {
	const [state, action] = useActionState(signInAsDemo, idleState);

	return (
		<section aria-labelledby="demo-heading" className="grid gap-3 rounded-lg border p-4">
			<h2 id="demo-heading" className="font-medium">
				Try it without signing up
			</h2>
			<p className="text-sm text-muted-foreground">
				A demo shop with made-up clients and bookings. Change anything you like; it resets every
				night.
			</p>
			<FormError message={state.status === 'error' ? state.message : undefined} />
			<form action={action} className="flex flex-wrap gap-2">
				<SubmitButton pendingLabel="Opening the demo…">Open the demo dashboard</SubmitButton>
				<Link href={`/${shopSlug}`} className={buttonVariants({ variant: 'outline', size: 'lg' })}>
					See a booking page
				</Link>
			</form>
		</section>
	);
}
