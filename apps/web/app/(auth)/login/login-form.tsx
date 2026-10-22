'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useActionState } from 'react';
import { FormError, TextField } from '@/components/forms/fields';
import { SubmitButton } from '@/components/forms/form-controls';
import { safeRedirectPath } from '@/lib/auth/redirect';
import { idleState } from '@/lib/forms';
import { signIn } from '../actions';

export function LoginForm() {
	const [state, action] = useActionState(signIn, idleState);
	const errors = state.status === 'error' ? state.fieldErrors : undefined;

	return (
		<form action={action} className="grid gap-4" noValidate>
			{/* Only these read the URL, so the form itself stays in the static shell. */}
			<Suspense fallback={null}>
				<NextPathField />
			</Suspense>
			{state.status === 'error' ? (
				<FormError message={state.message} />
			) : (
				<Suspense fallback={null}>
					<LinkErrorMessage />
				</Suspense>
			)}
			<TextField
				name="email"
				label="Email"
				type="email"
				autoComplete="email"
				required
				defaultValue={state.values?.email}
				error={errors?.email}
			/>
			<TextField
				name="password"
				label="Password"
				type="password"
				autoComplete="current-password"
				required
				error={errors?.password}
			/>
			<SubmitButton pendingLabel="Signing in…" className="h-11">
				Sign in
			</SubmitButton>
			<p className="text-sm text-muted-foreground">
				New to Fullcut?{' '}
				<Link href="/signup" className="font-medium text-foreground underline underline-offset-4">
					Create an account
				</Link>
			</p>
		</form>
	);
}

function NextPathField() {
	const next = safeRedirectPath(useSearchParams().get('next')) ?? '';
	return <input type="hidden" name="next" value={next} />;
}

function LinkErrorMessage() {
	const linkError = useSearchParams().get('error') === 'link';
	return (
		<FormError
			message={
				linkError ? 'That sign-in link is invalid or has expired. Sign in below.' : undefined
			}
		/>
	);
}
