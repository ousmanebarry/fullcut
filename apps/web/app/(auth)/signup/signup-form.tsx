'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { FormError, TextField } from '@/components/forms/fields';
import { SubmitButton } from '@/components/forms/form-controls';
import { idleState } from '@/lib/forms';
import { signUp } from '../actions';

export function SignupForm() {
	const [state, action] = useActionState(signUp, idleState);
	const errors = state.status === 'error' ? state.fieldErrors : undefined;

	if (state.status === 'success') {
		return (
			<p role="status" className="rounded-lg bg-muted px-3 py-3 text-sm">
				{state.message}
			</p>
		);
	}

	return (
		<form action={action} className="grid gap-4" noValidate>
			<FormError message={state.status === 'error' ? state.message : undefined} />
			<TextField
				name="name"
				label="Your name"
				autoComplete="name"
				required
				defaultValue={state.values?.name}
				error={errors?.name}
			/>
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
				autoComplete="new-password"
				required
				minLength={8}
				hint="At least 8 characters."
				error={errors?.password}
			/>
			<SubmitButton pendingLabel="Creating account…" className="h-11">
				Create account
			</SubmitButton>
			<p className="text-sm text-muted-foreground">
				Already have an account?{' '}
				<Link href="/login" className="font-medium text-foreground underline underline-offset-4">
					Sign in
				</Link>
			</p>
		</form>
	);
}
