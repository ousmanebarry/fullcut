// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { StepProgress } from '@/components/layout/step-progress';

afterEach(cleanup);

describe('StepProgress', () => {
	it('shows the step in words and fills one bar segment per completed step', () => {
		const { container } = render(<StepProgress current={2} total={3} />);
		expect(screen.getByText('Step 2 of 3')).toBeTruthy();
		const segments = container.querySelectorAll('[aria-hidden] > span');
		expect(Array.from(segments, (s) => s.className.includes('bg-primary'))).toEqual([
			true,
			true,
			false,
		]);
	});
});
