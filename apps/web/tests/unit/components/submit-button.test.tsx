// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { SubmitButton } from '@/components/forms/form-controls';

afterEach(cleanup);

describe('SubmitButton', () => {
	it('is disabled, busy and relabelled while the form action runs', async () => {
		let finish = () => {};
		const action = () =>
			new Promise<void>((resolve) => {
				finish = resolve;
			});
		const user = userEvent.setup();
		render(
			<form action={action}>
				<SubmitButton pendingLabel="Saving…">Save</SubmitButton>
			</form>,
		);

		await user.click(screen.getByRole('button', { name: 'Save' }));
		const pending = await screen.findByRole('button', { name: 'Saving…' });
		expect(pending.getAttribute('aria-busy')).toBe('true');
		expect(pending).toHaveProperty('disabled', true);

		finish();
		await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy());
		expect(screen.getByRole('button', { name: 'Save' }).getAttribute('aria-busy')).toBe('false');
	});
});
