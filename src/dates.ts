// Pure date math for the month grid and week numbers. Every date is a plain "YYYY-MM-DD" string and every step uses
// UTC day numbers, so a daylight saving change or the time zone of the device never moves a day.

/** A calendar day as "YYYY-MM-DD". */
export type IsoDate = string;

/** How the first week of a year is found. weekStart is 0 for Sunday to 6 for Saturday. */
export interface WeekRule {
	/** First day of the week, 0 Sunday to 6 Saturday. */
	weekStart: number;
	/** The first week of the year holds January 1 to minDays. ISO 8601 is 4, US is 1. */
	minDays: number;
}

export const ISO_RULE: WeekRule = { weekStart: 1, minDays: 4 };

const DAY_MS = 86_400_000;

function pad(n: number, width: number): string {
	return String(n).padStart(width, '0');
}

/** Day number since 1970-01-01 for a year, month (1 to 12) and day. */
export function dayNumber(y: number, m: number, d: number): number {
	return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);
}

/** "YYYY-MM-DD" from a day number. Years 0 to 9999 only. */
export function fromDayNumber(n: number): IsoDate {
	const t = new Date(n * DAY_MS);
	return `${pad(t.getUTCFullYear(), 4)}-${pad(t.getUTCMonth() + 1, 2)}-${pad(t.getUTCDate(), 2)}`;
}

/** Parts of "YYYY-MM-DD", or null for a text that is not a real day (2026-02-30 is not). */
export function parseIso(iso: string): { y: number; m: number; d: number } | null {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
	if (!m) return null;
	const y = Number(m[1]);
	const mo = Number(m[2]);
	const d = Number(m[3]);
	if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
	return { y, m: mo, d };
}

function toNumber(iso: IsoDate): number {
	const p = parseIso(iso);
	if (!p) throw new Error(`Not a date: ${iso}`);
	return dayNumber(p.y, p.m, p.d);
}

export function isLeapYear(y: number): boolean {
	return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y: number, m: number): number {
	return [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1] ?? 0;
}

/** Day of the week, 0 Sunday to 6 Saturday. */
export function weekday(iso: IsoDate): number {
	// 1970-01-01 was a Thursday (4).
	return (((toNumber(iso) + 4) % 7) + 7) % 7;
}

export function addDays(iso: IsoDate, days: number): IsoDate {
	return fromDayNumber(toNumber(iso) + days);
}

/** The first day of the week that holds iso. */
export function startOfWeek(iso: IsoDate, weekStart: number): IsoDate {
	const back = (weekday(iso) - weekStart + 7) % 7;
	return addDays(iso, -back);
}

/** Month moved by delta months. Months are 1 to 12. */
export function shiftMonth(y: number, m: number, delta: number): { y: number; m: number } {
	const i = y * 12 + (m - 1) + delta;
	return { y: Math.floor(i / 12), m: (((i % 12) + 12) % 12) + 1 };
}

/** Week number and week year of a day under a rule. Week 1 is the week that holds January minDays. */
export function weekOfYear(iso: IsoDate, rule: WeekRule): { week: number; year: number } {
	const p = parseIso(iso);
	if (!p) throw new Error(`Not a date: ${iso}`);
	const n = toNumber(iso);
	const week1 = (y: number) => toNumber(startOfWeek(`${pad(y, 4)}-01-${pad(rule.minDays, 2)}`, rule.weekStart));
	let year = p.y;
	if (n < week1(year)) year -= 1;
	else if (n >= week1(year + 1)) year += 1;
	return { week: Math.floor((n - week1(year)) / 7) + 1, year };
}

/** Quarter 1 to 4 of a month 1 to 12. */
export function quarterOf(m: number): number {
	return Math.floor((m - 1) / 3) + 1;
}

export interface GridWeek {
	/** Week number of the first day of the row under the rule. */
	week: number;
	/** Week year of the first day of the row. */
	weekYear: number;
	/** Seven days, the first is the week start. */
	days: IsoDate[];
}

/** The rows of a month: each week that holds a day of the month, 4 to 6 rows. */
export function monthGrid(y: number, m: number, rule: WeekRule): GridWeek[] {
	const first = `${pad(y, 4)}-${pad(m, 2)}-01`;
	const last = toNumber(`${pad(y, 4)}-${pad(m, 2)}-${pad(daysInMonth(y, m), 2)}`);
	const rows: GridWeek[] = [];
	for (let start = toNumber(startOfWeek(first, rule.weekStart)); start <= last; start += 7) {
		const days: IsoDate[] = [];
		for (let i = 0; i < 7; i++) days.push(fromDayNumber(start + i));
		const wk = weekOfYear(days[0] as IsoDate, rule);
		rows.push({ week: wk.week, weekYear: wk.year, days });
	}
	return rows;
}

/** The local calendar day of a time on this device. */
export function localIso(t: Date): IsoDate {
	return `${pad(t.getFullYear(), 4)}-${pad(t.getMonth() + 1, 2)}-${pad(t.getDate(), 2)}`;
}

/** Weekday indexes in display order, for the header row. */
export function weekdayOrder(weekStart: number): number[] {
	return Array.from({ length: 7 }, (_, i) => (weekStart + i) % 7);
}

/**
 * The week rule from a moment locale: dow is the first day of the week, doy decides week 1 (moment: janX = 7 + dow - doy).
 * Bad values fall back to ISO 8601.
 */
export function ruleFromLocale(dow: number, doy: number): WeekRule {
	const minDays = 7 + dow - doy;
	if (!Number.isInteger(dow) || dow < 0 || dow > 6 || !Number.isInteger(minDays) || minDays < 1 || minDays > 7) return { ...ISO_RULE };
	return { weekStart: dow, minDays };
}

/** Heat levels 0 to 4 for numbers: 0 for no value, 1 to 4 by the place between the lowest and the highest value. */
export function heatLevels(values: (number | null)[]): number[] {
	const nums = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
	if (!nums.length) return values.map(() => 0);
	const lo = Math.min(...nums);
	const hi = Math.max(...nums);
	return values.map((v) => {
		if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
		if (hi === lo) return 4;
		return Math.min(4, Math.floor(((v - lo) / (hi - lo)) * 4) + 1);
	});
}

/** Dots for a word count: one for each 250 words, 1 to 5. A note with 0 words still has 1 dot. */
export function dotCount(words: number): number {
	if (!Number.isFinite(words) || words <= 0) return 1;
	return Math.max(1, Math.min(5, Math.floor(words / 250) + 1));
}

/** Word count of note text without frontmatter. */
export function countWords(text: string): number {
	const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/, '');
	// CJK text has no spaces: count each character as one word.
	const CJK = /[぀-ヿ㐀-鿿가-힯]/gu;
	const cjk = body.match(CJK)?.length ?? 0;
	const m = body.replace(CJK, ' ').match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu);
	return (m?.length ?? 0) + cjk;
}
