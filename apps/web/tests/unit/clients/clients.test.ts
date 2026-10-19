import { describe, expect, it } from 'vitest';
import { clientSearchPattern } from '@/lib/clients/search';
import { medianIntervalDays, usualBooking, type VisitForUsual } from '@/lib/clients/stats';

const DAY = 24 * 60 * 60 * 1000;
const day = (n: number) => Date.UTC(2025, 0, 1) + n * DAY;

describe('medianIntervalDays', () => {
	it('needs at least two visits', () => {
		expect(medianIntervalDays([])).toBeNull();
		expect(medianIntervalDays([day(0)])).toBeNull();
	});

	it('takes the middle gap, whatever order visits arrive in', () => {
		expect(medianIntervalDays([day(60), day(0), day(28), day(100)])).toBe(32);
	});

	it('averages the two middle gaps for an even count', () => {
		expect(medianIntervalDays([day(0), day(20), day(50)])).toBe(25);
	});

	it('rounds to whole days so DST hours do not matter', () => {
		expect(medianIntervalDays([day(0), day(28) - 60 * 60 * 1000])).toBe(28);
	});
});

describe('usualBooking', () => {
	const active = {
		serviceIds: new Set(['cut', 'fade', 'beard']),
		staffIds: new Set(['alex', 'jordan']),
	};
	const visit = (
		n: number,
		serviceId: string,
		staffId: string,
		status = 'completed',
	): VisitForUsual => ({ startsAtMs: day(n), serviceId, staffId, status });

	it('picks the most frequent completed service and staff', () => {
		const history = [
			visit(1, 'cut', 'alex'),
			visit(2, 'fade', 'jordan'),
			visit(3, 'cut', 'alex'),
			visit(4, 'beard', 'jordan', 'cancelled'),
			visit(5, 'beard', 'jordan', 'no_show'),
		];
		expect(usualBooking(history, active)).toEqual({ serviceId: 'cut', staffId: 'alex' });
	});

	it('breaks ties with the most recent visit', () => {
		const history = [visit(1, 'cut', 'alex'), visit(2, 'fade', 'jordan')];
		expect(usualBooking(history, active)).toEqual({ serviceId: 'fade', staffId: 'jordan' });
	});

	it('falls back to any non-cancelled booking for new clients', () => {
		const history = [
			visit(1, 'cut', 'alex', 'cancelled'),
			visit(9, 'beard', 'jordan', 'confirmed'),
		];
		expect(usualBooking(history, active)).toEqual({ serviceId: 'beard', staffId: 'jordan' });
	});

	it('skips services and staff that are no longer active', () => {
		const history = [
			visit(1, 'retired', 'gone'),
			visit(2, 'retired', 'gone'),
			visit(3, 'cut', 'alex'),
		];
		expect(usualBooking(history, active)).toEqual({ serviceId: 'cut', staffId: 'alex' });
		expect(usualBooking([], active)).toEqual({ serviceId: null, staffId: null });
	});
});

describe('clientSearchPattern', () => {
	it.each([
		['(416) 555-0123', { phone: '%4165550123%' }],
		['+1 416 555 0123', { phone: '%14165550123%' }],
		['555', { phone: '%555%' }],
	])('treats %j as a phone search', (query, pattern) => {
		expect(clientSearchPattern(query)).toEqual(pattern);
	});

	it.each([
		['Sam', { name: '%Sam%' }],
		['  Sam Lee ', { name: '%Sam Lee%' }],
		['12', { name: '%12%' }],
		['100%_off', { name: '%100\\%\\_off%' }],
		['Agent 007', { name: '%Agent 007%' }],
	])('treats %j as a name search', (query, pattern) => {
		expect(clientSearchPattern(query)).toEqual(pattern);
	});
});
