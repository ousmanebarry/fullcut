// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SlotList, type SlotListState } from '@/components/booking/slot-list';
import type { PublicSlot } from '@/lib/public-booking/types';

function slot(time: string, period: PublicSlot['period'], startsAt: string): PublicSlot {
	return {
		startsAt,
		date: '2026-11-02',
		time,
		label: `Monday, November 2 at ${time}`,
		period,
		staffId: 'staff-1',
	};
}

const SLOTS = [
	slot('9:00 AM', 'morning', '2026-11-02T14:00:00Z'),
	slot('9:30 AM', 'morning', '2026-11-02T14:30:00Z'),
	slot('2:00 PM', 'afternoon', '2026-11-02T19:00:00Z'),
];

function renderList(state: SlotListState, selected: PublicSlot | null = null) {
	const handlers = {
		onPick: vi.fn(),
		onRetry: vi.fn(),
		onJumpToDate: vi.fn(),
		onJumpToNextDay: vi.fn(),
	};
	render(<SlotList state={state} selected={selected} idPrefix="t" {...handlers} />);
	return handlers;
}

afterEach(cleanup);

describe('SlotList', () => {
	it('announces loading', () => {
		renderList({ kind: 'loading' });
		expect(screen.getByText('Loading times…')).toBeTruthy();
		expect(screen.queryAllByRole('button')).toHaveLength(0);
	});

	it('shows the error with a retry', async () => {
		const user = userEvent.setup();
		const { onRetry } = renderList({ kind: 'error', message: 'Could not load times.' });
		expect(screen.getByRole('alert').textContent).toBe('Could not load times.');
		await user.click(screen.getByRole('button', { name: 'Try again' }));
		expect(onRetry).toHaveBeenCalledOnce();
	});

	it('offers the next open date when the week is empty', async () => {
		const user = userEvent.setup();
		const { onJumpToDate } = renderList({ kind: 'week-empty', nextOpenDate: '2026-11-09' });
		await user.click(screen.getByRole('button', { name: /^Jump to/ }));
		expect(onJumpToDate).toHaveBeenCalledWith('2026-11-09');
	});

	it('tells the client to contact the shop when nothing is open', () => {
		renderList({ kind: 'week-empty', nextOpenDate: null });
		expect(screen.getByText(/contact the shop/)).toBeTruthy();
	});

	it('offers the next open day when the chosen day has no times', async () => {
		const user = userEvent.setup();
		const { onJumpToNextDay } = renderList({ kind: 'day', date: '2026-11-02', slots: [] });
		await user.click(screen.getByRole('button', { name: 'Jump to next open day' }));
		expect(onJumpToNextDay).toHaveBeenCalledOnce();
	});

	it('groups times by period and marks the selected one', async () => {
		const user = userEvent.setup();
		const { onPick } = renderList({ kind: 'day', date: '2026-11-02', slots: SLOTS }, SLOTS[1]!);

		expect(screen.getByRole('region', { name: 'Morning' })).toBeTruthy();
		expect(screen.getByRole('region', { name: 'Afternoon' })).toBeTruthy();
		expect(screen.queryByRole('region', { name: 'Evening' })).toBeNull();

		const pressed = screen.getAllByRole('button', { pressed: true });
		expect(pressed.map((b) => b.textContent)).toEqual(['9:30 AM']);

		await user.click(screen.getByRole('button', { name: SLOTS[2]!.label }));
		expect(onPick).toHaveBeenCalledWith(SLOTS[2]);
	});
});
