import { describe, expect, it } from 'vitest';
import vectors from './vectors/month-calendar.json';
import { countWords, daysInMonth, dotCount, heatLevels, isLeapYear, ruleFromLocale, shiftMonth, startOfWeek, weekOfYear } from '../src/dates';

const fns: Record<string, (...args: never[]) => unknown> = { weekOfYear, ruleFromLocale, isLeapYear, daysInMonth, shiftMonth, startOfWeek, dotCount, heatLevels, countWords };

describe('golden vectors (packages/spec/vectors/month-calendar.json)', () => {
	it('covers acceptance cases 1 to 8', () => {
		for (const n of ['1', '2', '3', '4', '5', '6', '7', '8']) expect(vectors.cases.some((c) => c.name.startsWith(`${n} `))).toBe(true);
		expect(vectors.cases.length).toBeGreaterThanOrEqual(20);
	});
	for (const c of vectors.cases) {
		it(c.name, () => {
			const fn = fns[c.fn];
			expect(fn).toBeTypeOf('function');
			expect(fn!(...(c.args as never[]))).toEqual(c.expected);
		});
	}
});
