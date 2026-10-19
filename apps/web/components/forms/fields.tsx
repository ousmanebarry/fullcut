import type * as React from 'react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export const nativeControlClass =
	'h-9 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive md:text-sm';

export function describedBy(id: string, error?: string, hint?: string): React.AriaAttributes {
	const ids = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(' ');
	return { 'aria-invalid': error ? true : undefined, 'aria-describedby': ids || undefined };
}

interface FieldShellProps {
	id: string;
	label: string;
	error?: string;
	hint?: string;
	className?: string;
	children: React.ReactNode;
}

export function FieldShell({ id, label, error, hint, className, children }: FieldShellProps) {
	return (
		<div className={cn('grid gap-1.5', className)}>
			<Label htmlFor={id}>{label}</Label>
			{children}
			{hint ? (
				<p id={`${id}-hint`} className="text-xs text-muted-foreground">
					{hint}
				</p>
			) : null}
			{error ? (
				<p id={`${id}-error`} className="text-sm text-destructive">
					{error}
				</p>
			) : null}
		</div>
	);
}

type TextFieldProps = Omit<React.ComponentProps<'input'>, 'id' | 'name'> & {
	name: string;
	label: string;
	id?: string;
	error?: string;
	hint?: string;
};

export function TextField({
	name,
	label,
	id = name,
	error,
	hint,
	className,
	...props
}: TextFieldProps) {
	return (
		<FieldShell id={id} label={label} error={error} hint={hint} className={className}>
			<Input id={id} name={name} className="h-9" {...describedBy(id, error, hint)} {...props} />
		</FieldShell>
	);
}

type TextAreaFieldProps = Omit<React.ComponentProps<'textarea'>, 'id' | 'name'> & {
	name: string;
	label: string;
	id?: string;
	error?: string;
	hint?: string;
};

export function TextAreaField({
	name,
	label,
	id = name,
	error,
	hint,
	className,
	...props
}: TextAreaFieldProps) {
	return (
		<FieldShell id={id} label={label} error={error} hint={hint} className={className}>
			<Textarea id={id} name={name} {...describedBy(id, error, hint)} {...props} />
		</FieldShell>
	);
}

export function FormError({ message }: { message?: string }) {
	if (!message) return null;
	return (
		<p
			role="alert"
			className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-red-800 dark:text-destructive"
		>
			{message}
		</p>
	);
}
