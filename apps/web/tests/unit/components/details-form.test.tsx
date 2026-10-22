// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DetailsForm } from '@/components/booking/details-form';
import { createBooking } from '@/lib/public-booking/client-api';
import type { PublicShop, PublicSlot } from '@/lib/public-booking/types';

vi.mock('@/lib/public-booking/client-api', () => ({ createBooking: vi.fn() }));

const SHOP: PublicShop = {
	slug: 'demo',
	name: 'Demo Barbers',
	aboutText: null,
	address: null,
	phone: null,
	logoUrl: null,
	timezone: 'America/Toronto',
	currency: 'CAD',
	country: 'CA',
	waitlistEnabled: false,
	services: [{ id: 'svc', name: 'Haircut', durationMinutes: 30, priceCents: 3500 }],
	staff: [{ id: 'staff-1', displayName: 'Alex' }],
};

const SLOT: PublicSlot = {
	startsAt: '2026-11-02T15:00:00Z',
	staffId: 'staff-1',
	label: 'Monday, November 2 at 10:00 AM',
	date: '2026-11-02',
	time: '10:00 AM',
	period: 'morning',
};

const OTHER_SLOT: PublicSlot = {
	...SLOT,
	startsAt: '2026-11-02T15:30:00Z',
	time: '10:30 AM',
	label: 'Monday, November 2 at 10:30 AM',
};

function renderForm() {
	const props = { onSlotChange: vi.fn(), onBooked: vi.fn() };
	render(
		<DetailsForm
			shop={SHOP}
			serviceId="svc"
			staffChoice="any"
			slot={SLOT}
			summary={{
				serviceName: 'Haircut',
				staffName: 'Alex',
				when: SLOT.label,
				durationMinutes: 30,
				priceCents: 3500,
				currency: 'CAD',
			}}
			{...props}
		/>,
	);
	return props;
}

beforeEach(() => vi.mocked(createBooking).mockReset());
afterEach(cleanup);

describe('DetailsForm', () => {
	it('flags missing fields, focuses the first one and does not submit', async () => {
		const user = userEvent.setup();
		renderForm();
		await user.click(screen.getByRole('button', { name: 'Confirm booking' }));

		const name = screen.getByLabelText('Name');
		expect(document.activeElement).toBe(name);
		expect(name.getAttribute('aria-invalid')).toBe('true');
		expect(screen.getByText('Enter your name.')).toBeTruthy();
		expect(screen.getByText('Enter your mobile number.')).toBeTruthy();
		expect(createBooking).not.toHaveBeenCalled();
	});

	it('shows nearby times when the slot was just taken and lets the client pick one', async () => {
		vi.mocked(createBooking).mockResolvedValue({
			ok: false,
			error: {
				error: 'slot_taken',
				message: 'That time was just taken.',
				suggestions: [OTHER_SLOT],
			},
		});
		const user = userEvent.setup();
		const { onSlotChange, onBooked } = renderForm();

		await user.type(screen.getByLabelText('Name'), 'Sam Lee');
		await user.type(screen.getByLabelText('Mobile number'), '4165550101');
		await user.click(screen.getByRole('button', { name: 'Confirm booking' }));

		await waitFor(() =>
			expect(screen.getByRole('alert').textContent).toBe('That time was just taken.'),
		);
		expect(createBooking).toHaveBeenCalledOnce();
		expect(onBooked).not.toHaveBeenCalled();

		await user.click(screen.getByRole('button', { name: OTHER_SLOT.label }));
		expect(onSlotChange).toHaveBeenCalledWith(OTHER_SLOT);
	});
});
