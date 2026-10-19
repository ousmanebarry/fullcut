import type { z } from 'zod';

export type FieldErrors = Record<string, string>;

export type FormState =
	| { status: 'idle'; values?: Record<string, string> }
	| { status: 'success'; message: string; at: number; values?: Record<string, string> }
	| {
			status: 'error';
			message?: string;
			fieldErrors?: FieldErrors;
			at: number;
			values?: Record<string, string>;
	  };

export const idleState: FormState = { status: 'idle' };

export function success(message: string, values?: Record<string, string>): FormState {
	return { status: 'success', message, at: Date.now(), values };
}

export function failure(
	message: string | undefined,
	fieldErrors?: FieldErrors,
	values?: Record<string, string>,
): FormState {
	return { status: 'error', message, fieldErrors, at: Date.now(), values };
}

// First message per field, keyed by dotted path (e.g. "services.0.name").
export function fieldErrorsFrom(error: z.ZodError): FieldErrors {
	const result: FieldErrors = {};
	for (const issue of error.issues) {
		const key = issue.path.map(String).join('.') || '_form';
		result[key] ??= issue.message;
	}
	return result;
}

// Echoes text inputs back so React's post-action form reset keeps what the user typed.
export function formValues(formData: FormData): Record<string, string> {
	const values: Record<string, string> = {};
	for (const [key, value] of formData.entries()) {
		if (typeof value === 'string' && !key.startsWith('$ACTION')) values[key] = value;
	}
	return values;
}

export function textField(formData: FormData, key: string): string {
	const value = formData.get(key);
	return typeof value === 'string' ? value : '';
}

export function checkboxField(formData: FormData, key: string): boolean {
	return formData.get(key) === 'on';
}
