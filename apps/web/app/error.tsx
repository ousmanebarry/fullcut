'use client';

import { ErrorState } from '@/components/error-state';

export default function RootError(props: { error: unknown; retry: () => void }) {
	return (
		<main className="flex flex-1 flex-col">
			<ErrorState {...props} />
		</main>
	);
}
