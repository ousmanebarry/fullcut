// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { StaffTabs } from '@/components/dashboard/staff-tabs';

const STAFF = [
	{ id: 'a', name: 'Alex' },
	{ id: 'b', name: 'Blair' },
	{ id: 'c', name: 'Casey' },
];

function Harness({ initial = 'a' }: { initial?: string }) {
	const [selected, setSelected] = useState(initial);
	return <StaffTabs staff={STAFF} selectedId={selected} onSelect={setSelected} />;
}

afterEach(cleanup);

describe('StaffTabs', () => {
	it('makes only the selected tab focusable', () => {
		render(<Harness initial="b" />);
		const tabs = screen.getAllByRole('tab');
		expect(tabs.map((t) => t.tabIndex)).toEqual([-1, 0, -1]);
		expect(screen.getByRole('tab', { selected: true })).toHaveProperty('textContent', 'Blair');
	});

	it('falls back to the first tab when nothing matches', () => {
		render(<Harness initial="missing" />);
		expect(screen.getByRole('tab', { selected: true })).toHaveProperty('textContent', 'Alex');
	});

	it('moves focus and selection with arrow, Home and End keys, wrapping around', async () => {
		const user = userEvent.setup();
		render(<Harness />);
		await user.tab();
		expect(document.activeElement?.textContent).toBe('Alex');

		await user.keyboard('{ArrowRight}');
		expect(document.activeElement?.textContent).toBe('Blair');
		expect(screen.getByRole('tab', { selected: true }).textContent).toBe('Blair');

		await user.keyboard('{End}');
		expect(screen.getByRole('tab', { selected: true }).textContent).toBe('Casey');

		await user.keyboard('{ArrowRight}');
		expect(screen.getByRole('tab', { selected: true }).textContent).toBe('Alex');

		await user.keyboard('{ArrowLeft}');
		expect(document.activeElement?.textContent).toBe('Casey');

		await user.keyboard('{Home}');
		expect(screen.getByRole('tab', { selected: true }).textContent).toBe('Alex');
	});

	it('selects on click', async () => {
		const user = userEvent.setup();
		render(<Harness />);
		await user.click(screen.getByRole('tab', { name: 'Casey' }));
		expect(screen.getByRole('tab', { selected: true }).textContent).toBe('Casey');
	});
});
