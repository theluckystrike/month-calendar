import { afterAll, describe, expect, it } from 'vitest';
import { moment } from 'obsidian';
import { ISO_RULE, addDays, daysInMonth, isLeapYear, localIso, monthGrid, parseIso, ruleFromLocale, weekOfYear, weekday, weekdayOrder, type WeekRule } from '../src/dates';

// Test locales with the week data of real moment locales: en (dow 0, doy 6), de (dow 1, doy 4), ar-ma (dow 6, doy 12).
const LOCALES: Record<string, { dow: number; doy: number }> = {
	'mc-test-en': { dow: 0, doy: 6 },
	'mc-test-de': { dow: 1, doy: 4 },
	'mc-test-arma': { dow: 6, doy: 12 },
};
const previous = moment.locale();
for (const [name, week] of Object.entries(LOCALES)) moment.defineLocale(name, { week });
moment.locale(previous);
afterAll(() => {
	moment.locale(previous);
});

function each(from: string, to: string, fn: (iso: string) => void): void {
	for (let d = from; d <= to; d = addDays(d, 1)) fn(d);
}

describe('week numbers', () => {
	for (const [name, { dow, doy }] of Object.entries(LOCALES)) {
		it(`agree with moment for each day of 2018 to 2032 in locale ${name}`, () => {
			const rule = ruleFromLocale(dow, doy);
			let checked = 0;
			each('2018-01-01', '2032-12-31', (iso) => {
				const m = moment(iso, 'YYYY-MM-DD', true).locale(name);
				const got = weekOfYear(iso, rule);
				if (got.week !== m.week() || got.year !== m.weekYear()) throw new Error(`${name} ${iso}: ${JSON.stringify(got)} != ${m.week()}/${m.weekYear()}`);
				checked++;
			});
			expect(checked).toBe(5479);
		});
	}

	it('agree with moment ISO weeks for each day of 2018 to 2032', () => {
		each('2018-01-01', '2032-12-31', (iso) => {
			const m = moment(iso, 'YYYY-MM-DD', true);
			const got = weekOfYear(iso, ISO_RULE);
			if (got.week !== m.isoWeek() || got.year !== m.isoWeekYear()) throw new Error(`${iso}: ${JSON.stringify(got)}`);
		});
	});

	it('give 52 or 53 weeks and never week 0 for each week start and first-week rule', () => {
		for (let weekStart = 0; weekStart < 7; weekStart++) {
			for (let minDays = 1; minDays <= 7; minDays++) {
				const rule: WeekRule = { weekStart, minDays };
				each('2023-12-20', '2025-01-10', (iso) => {
					const w = weekOfYear(iso, rule);
					if (w.week < 1 || w.week > 53) throw new Error(`${iso} ${JSON.stringify(rule)} week ${w.week}`);
				});
			}
		}
	});
});

describe('month grid', () => {
	it('February 2026 with a Sunday start fills exactly 4 rows', () => {
		const g = monthGrid(2026, 2, { weekStart: 0, minDays: 1 });
		expect(g).toHaveLength(4);
		expect(g[0]?.days[0]).toBe('2026-02-01');
		expect(g[3]?.days[6]).toBe('2026-02-28');
	});

	it('has 4 to 6 rows, starts on the week start and holds each day of the month one time', () => {
		for (let y = 2023; y <= 2029; y++) {
			for (let m = 1; m <= 12; m++) {
				for (const weekStart of [0, 1, 6]) {
					const g = monthGrid(y, m, { weekStart, minDays: 1 });
					expect(g.length).toBeGreaterThanOrEqual(4);
					expect(g.length).toBeLessThanOrEqual(6);
					const days = g.flatMap((r) => r.days);
					for (const r of g) expect(weekday(r.days[0] as string)).toBe(weekStart);
					for (let i = 1; i < days.length; i++) expect(days[i]).toBe(addDays(days[i - 1] as string, 1));
					const inMonth = days.filter((d) => parseIso(d)?.m === m);
					expect(inMonth).toHaveLength(daysInMonth(y, m));
				}
			}
		}
	});

	it('crosses the year end with the right week numbers', () => {
		const dec = monthGrid(2026, 12, ISO_RULE);
		const last = dec[dec.length - 1]!;
		expect(last.days).toContain('2026-12-31');
		expect(last.days[6]).toBe('2027-01-03');
		expect(last.week).toBe(53);
		const jan = monthGrid(2027, 1, ISO_RULE);
		expect(jan[0]?.days[0]).toBe('2026-12-28');
		expect(jan[0]?.week).toBe(53);
		expect(jan[0]?.weekYear).toBe(2026);
		expect(jan[1]?.week).toBe(1);
	});

	it('shows 29 February in a leap year only', () => {
		expect(monthGrid(2028, 2, ISO_RULE).flatMap((r) => r.days)).toContain('2028-02-29');
		expect(monthGrid(2027, 2, ISO_RULE).flatMap((r) => r.days)).not.toContain('2027-02-29');
		expect(isLeapYear(1900)).toBe(false);
		expect(isLeapYear(2400)).toBe(true);
		expect(parseIso('2027-02-29')).toBeNull();
		expect(parseIso('2028-02-29')).toEqual({ y: 2028, m: 2, d: 29 });
	});

	it('does not move or repeat a day across daylight saving changes in any time zone', () => {
		const saved = process.env.TZ;
		try {
			for (const tz of ['America/New_York', 'Europe/Warsaw', 'Australia/Lord_Howe', 'America/Santiago', 'Asia/Bangkok', 'UTC']) {
				process.env.TZ = tz;
				for (const [y, m] of [
					[2026, 3],
					[2026, 4],
					[2026, 10],
					[2026, 11],
				] as const) {
					const days = monthGrid(y, m, ISO_RULE).flatMap((r) => r.days);
					expect(new Set(days).size).toBe(days.length);
					expect(days.filter((d) => parseIso(d)?.m === m)).toHaveLength(daysInMonth(y, m));
				}
				// Local midnight and late evening on the day of a change give the local day.
				expect(localIso(new Date(2026, 2, 8, 0, 30))).toBe('2026-03-08');
				expect(localIso(new Date(2026, 9, 25, 23, 30))).toBe('2026-10-25');
			}
		} finally {
			if (saved === undefined) delete process.env.TZ;
			else process.env.TZ = saved;
		}
	});

	it('orders the weekday header from the week start', () => {
		expect(weekdayOrder(1)).toEqual([1, 2, 3, 4, 5, 6, 0]);
		expect(weekdayOrder(6)).toEqual([6, 0, 1, 2, 3, 4, 5]);
	});
});
