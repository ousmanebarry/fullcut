'use client';

import { ErrorState } from '@/components/error-state';

export default function DashboardError(props: { error: unknown; retry: () => void }) {
	return <ErrorState {...props} />;
}
