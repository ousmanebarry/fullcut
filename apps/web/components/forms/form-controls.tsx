'use client';

import { useEffect, useRef } from 'react';
import { useFormStatus } from 'react-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import type { FormState } from '@/lib/forms';

export function SubmitButton({
	children,
	pendingLabel = 'Saving…',
	className,
	variant,
}: {
	children: React.ReactNode;
	pendingLabel?: string;
	className?: string;
	variant?: React.ComponentProps<typeof Button>['variant'];
}) {
	const { pending } = useFormStatus();
	return (
		<Button
			type="submit"
			size="lg"
			disabled={pending}
			aria-disabled={pending}
			aria-busy={pending}
			className={className}
			variant={variant}
		>
			{pending ? pendingLabel : children}
		</Button>
	);
}

// Toasts once per action result (keyed by its timestamp).
export function useFormToast(state: FormState) {
	const shown = useRef<number | null>(null);
	useEffect(() => {
		if (state.status === 'idle' || shown.current === state.at) return;
		shown.current = state.at;
		if (state.status === 'success') toast.success(state.message);
		else if (state.message) toast.error(state.message);
	}, [state]);
}
