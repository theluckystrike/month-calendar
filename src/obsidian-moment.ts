// The moment instance of Obsidian, through a small typed surface. The exported repository has no moment typings of its
// own, so the directory lint can not resolve the moment types of the obsidian package (tools/dir-lint.mjs).
import * as obsidian from 'obsidian';

export interface MomentLike {
	format(format?: string): string;
	isValid(): boolean;
	locale(locale: string): MomentLike;
}

export interface LocaleDataLike {
	firstDayOfWeek(): number;
	firstDayOfYear(): number;
	months(m: MomentLike, format?: string): string;
	weekdays(): string[];
	weekdaysMin(): string[];
	ordinal(n: number): string;
}

export type MomentFn = ((input?: string | Date, format?: string, strict?: boolean) => MomentLike) & {
	locale(): string;
	locales(): string[];
	localeData(locale?: string): LocaleDataLike;
};

/** The moment function that Obsidian bundles. */
export const moment = (obsidian as unknown as { moment: MomentFn }).moment;
