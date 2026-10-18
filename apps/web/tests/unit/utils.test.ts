import { describe, expect, it } from 'vitest';
import { cn } from '@/lib/utils';

describe('cn', () => {
	it('drops falsy values and lets later Tailwind classes win', () => {
		const hidden = false;
		expect(cn('px-2 py-1', hidden && 'hidden', 'px-4')).toBe('py-1 px-4');
	});
});
