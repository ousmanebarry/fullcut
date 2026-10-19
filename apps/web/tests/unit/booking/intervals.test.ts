import { describe, expect, it } from 'vitest';
import {
	containsInterval,
	intersectIntervals,
	mergeIntervals,
	subtractIntervals,
	type Interval,
} from '@/lib/booking/intervals';
import type { Instant } from '@/lib/time';

const iv = (start: number, end: number): Interval => ({
	start: start as Instant,
	end: end as Instant,
});

describe('mergeIntervals', () => {
	it('returns an empty list for empty input', () => {
		expect(mergeIntervals([])).toEqual([]);
	});

	it('sorts and merges overlapping intervals', () => {
		expect(mergeIntervals([iv(5, 8), iv(1, 3), iv(2, 6)])).toEqual([iv(1, 8)]);
	});

	it('merges touching (back-to-back) intervals', () => {
		expect(mergeIntervals([iv(1, 3), iv(3, 5)])).toEqual([iv(1, 5)]);
	});

	it('keeps disjoint intervals apart and drops empty ones', () => {
		expect(mergeIntervals([iv(6, 9), iv(4, 4), iv(1, 3), iv(8, 7)])).toEqual([iv(1, 3), iv(6, 9)]);
	});

	it('absorbs contained intervals', () => {
		expect(mergeIntervals([iv(1, 10), iv(3, 4)])).toEqual([iv(1, 10)]);
	});
});

describe('subtractIntervals', () => {
	it('returns the base when there is nothing to cut', () => {
		expect(subtractIntervals([iv(1, 10)], [])).toEqual([iv(1, 10)]);
	});

	it('splits a base around a cut in the middle', () => {
		expect(subtractIntervals([iv(1, 10)], [iv(4, 6)])).toEqual([iv(1, 4), iv(6, 10)]);
	});

	it('trims cuts overlapping either edge', () => {
		expect(subtractIntervals([iv(1, 10)], [iv(0, 3), iv(8, 12)])).toEqual([iv(3, 8)]);
	});

	it('leaves the base intact when a cut only touches it', () => {
		expect(subtractIntervals([iv(3, 6)], [iv(1, 3), iv(6, 8)])).toEqual([iv(3, 6)]);
	});

	it('returns nothing when a cut contains the base', () => {
		expect(subtractIntervals([iv(3, 6)], [iv(1, 8)])).toEqual([]);
		expect(subtractIntervals([iv(3, 6)], [iv(3, 6)])).toEqual([]);
	});

	it('handles several bases and back-to-back cuts', () => {
		expect(subtractIntervals([iv(0, 10), iv(20, 30)], [iv(2, 4), iv(4, 6), iv(25, 40)])).toEqual([
			iv(0, 2),
			iv(6, 10),
			iv(20, 25),
		]);
	});
});

describe('intersectIntervals', () => {
	it('returns the overlap', () => {
		expect(intersectIntervals([iv(1, 5)], [iv(3, 8)])).toEqual([iv(3, 5)]);
	});

	it('returns nothing for touching or disjoint intervals', () => {
		expect(intersectIntervals([iv(1, 3)], [iv(3, 5)])).toEqual([]);
		expect(intersectIntervals([iv(1, 2)], [iv(5, 6)])).toEqual([]);
		expect(intersectIntervals([], [iv(1, 2)])).toEqual([]);
	});

	it('returns the contained interval', () => {
		expect(intersectIntervals([iv(0, 10)], [iv(2, 4), iv(6, 12)])).toEqual([iv(2, 4), iv(6, 10)]);
	});
});

describe('containsInterval', () => {
	it('accepts exact fits and inner intervals, rejects overhangs', () => {
		expect(containsInterval(iv(1, 10), iv(1, 10))).toBe(true);
		expect(containsInterval(iv(1, 10), iv(2, 9))).toBe(true);
		expect(containsInterval(iv(1, 10), iv(0, 5))).toBe(false);
		expect(containsInterval(iv(1, 10), iv(5, 11))).toBe(false);
	});
});
