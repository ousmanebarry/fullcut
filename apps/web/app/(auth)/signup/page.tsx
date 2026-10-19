import type { Metadata } from 'next';
import { SignupForm } from './signup-form';

export const metadata: Metadata = { title: 'Create your account · Fullcut' };

export default function SignupPage() {
	return (
		<>
			<div className="grid gap-1">
				<h1 className="text-2xl font-semibold">Create your account</h1>
				<p className="text-sm text-muted-foreground">
					Flat price, zero commission. Your clients stay yours.
				</p>
			</div>
			<SignupForm />
		</>
	);
}
