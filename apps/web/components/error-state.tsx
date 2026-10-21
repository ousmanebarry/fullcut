'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

export function ErrorState({ error, retry }: { error: unknown; retry: () => void }) {
	useEffect(() => {
		console.error(error);
	}, [error]);

	return (
		<div role="alert" className="mx-auto grid w-full max-w-lg gap-3 px-4 py-16 text-center">
			<h1 className="text-2xl font-semibold">Something went wrong</h1>
			<p className="text-sm text-muted-foreground">
				Nothing was lost. Try again, and if it keeps happening, reload the page.
			</p>
			<div>
				<Button type="button" onClick={retry}>
					Try again
				</Button>
			</div>
		</div>
	);
}
