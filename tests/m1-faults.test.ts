// Unit M1 of sprint s1111a: tests for the planted faults that the earlier tests did not catch. Each block names the
// fault it guards (lanes/M1/faults.tsv): locale fallback, exact daily note, dot count, delete in the index, the Pro
// gate of the year cell, the today ring at midnight and the month step back over a year.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, moment } from 'obsidian-test-mocks/obsidian';
import MonthCalendarPlugin from '../src/main';
import { MonthCalendarView } from '../src/view';
import { dotCount, heatLevels, shiftMonth } from '../src/dates';
import { numberFromProperty } from '../src/notes';
import { DEFAULT_SETTINGS, effectiveLocale } from '../src/settings';
import { bindPro, resetPro } from '../src/pro';
import manifest from '../manifest.json';

afterEach(() => {
	resetPro();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

async function plugin(files: Record<string, string>, settings: Record<string, unknown> = {}) {
	const app = App.createConfigured__({ files });
	const p = new MonthCalendarPlugin(app as never, manifest as never);
	await p.loadSettings();
	Object.assign(p.settings, settings);
	return { app, p };
}

async function view(files: Record<string, string>, settings: Record<string, unknown> = {}) {
	const { app, p } = await plugin(files, settings);
	const v = new MonthCalendarView(app.workspace.getLeaf(true) as never, p);
	v.showMonth(2026, 11);
	await v.onOpen();
	await v.refresh(true);
	return { app, p, v };
}

async function settle(): Promise<void> {
	for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
}

const cellOf = (v: MonthCalendarView, iso: string) => v.contentEl.querySelector<HTMLElement>(`[data-date="${iso}"]`);

describe('locale fallback (F04)', () => {
	it('an unknown locale code falls back to the language of Obsidian', () => {
		const auto = moment.locale();
		expect(effectiveLocale({ ...DEFAULT_SETTINGS, locale: 'zz-not-a-locale' })).toBe(auto);
		expect(effectiveLocale({ ...DEFAULT_SETTINGS, locale: 'auto' })).toBe(auto);
		const known = moment.locales()[0] as string;
		expect(effectiveLocale({ ...DEFAULT_SETTINGS, locale: known })).toBe(known);
	});
});

describe('the exact daily note wins over a prefix note (F08)', () => {
	it('openPeriod opens the exact note when a prefix note is passed', async () => {
		const { app, p } = await plugin({ '2026-11-10 Standup.md': 'standup', '2026-11-10.md': 'daily' });
		const prefix = app.vault.getFileByPath('2026-11-10 Standup.md');
		await p.openPeriod('day', '2026-11-10', false, prefix as never);
		expect(app.workspace.getActiveFile()?.path).toBe('2026-11-10.md');
	});

	it('openPeriod creates the exact note when only a prefix note exists', async () => {
		const { app, p } = await plugin({ '2026-11-10 Standup.md': 'standup' });
		const prefix = app.vault.getFileByPath('2026-11-10 Standup.md');
		await p.openPeriod('day', '2026-11-10', false, prefix as never);
		expect(app.vault.getFileByPath('2026-11-10.md')).toBeTruthy();
		expect(app.workspace.getActiveFile()?.path).toBe('2026-11-10.md');
		expect(await app.vault.read(prefix as never)).toBe('standup');
	});
});

describe('dot count (F09)', () => {
	it('gives one dot for each full 250 words, 1 to 5', () => {
		const cases: [number, number][] = [
			[0, 1],
			[1, 1],
			[124, 1],
			[200, 1],
			[249, 1],
			[250, 2],
			[374, 2],
			[499, 2],
			[500, 3],
			[999, 4],
			[1000, 5],
			[9000, 5],
		];
		for (const [words, dots] of cases) expect(dotCount(words), `${words} words`).toBe(dots);
	});
});

describe('a delete removes the day from the index (F11)', () => {
	it('a deleted daily note loses its dot', async () => {
		const { app, v } = await view({ 'Daily/2026-11-09.md': 'x' }, { dailySource: 'custom', dailyFolder: 'Daily' });
		expect(cellOf(v, '2026-11-09')?.classList.contains('has-note')).toBe(true);
		await app.vault.delete(app.vault.getFileByPath('Daily/2026-11-09.md') as never);
		await new Promise((r) => setTimeout(r, 400));
		await settle();
		expect(cellOf(v, '2026-11-09')?.classList.contains('has-note')).toBe(false);
		expect(cellOf(v, '2026-11-09')?.querySelectorAll('.mc-dot').length).toBe(0);
		// The draw skips paths without a file, so check the index too: a stale path would stay there for ever.
		const index = (v as unknown as { index: { files(day: string): string[] } | null }).index;
		expect(index?.files('2026-11-09')).toEqual([]);
	});
});

describe('the year cell of the quarter strip is Pro (F12)', () => {
	it('a click on the year cell opens nothing when Pro ended after the draw', async () => {
		bindPro({ isPro: () => true, onChange: () => () => undefined } as never);
		const { p, v } = await view({}, { showQuarterRow: true });
		const open = vi.spyOn(p, 'openPeriod').mockResolvedValue(undefined);
		resetPro();
		const year = v.contentEl.querySelector<HTMLElement>('.mc-period.mc-year');
		expect(year).toBeTruthy();
		year?.click();
		expect(open).not.toHaveBeenCalled();
		// The year button in the title stays free.
		v.contentEl.querySelector<HTMLElement>('.mc-period-title.mc-year')?.click();
		expect(open).toHaveBeenCalledWith('year', '2026-11-01', false, undefined);
	});
});

describe('the today ring moves at midnight (F14)', () => {
	it('the minute check moves is-today to the new day', async () => {
		const ticks: (() => void)[] = [];
		vi.spyOn(window, 'setInterval').mockImplementation(((cb: () => void) => {
			ticks.push(cb);
			return 0;
		}) as never);
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date(2026, 10, 10, 23, 59, 30));
		const { v } = await view({});
		expect(cellOf(v, '2026-11-10')?.classList.contains('is-today')).toBe(true);
		vi.setSystemTime(new Date(2026, 10, 11, 0, 0, 30));
		for (const t of ticks) t();
		await settle();
		expect(cellOf(v, '2026-11-11')?.classList.contains('is-today')).toBe(true);
		expect(cellOf(v, '2026-11-11')?.getAttribute('aria-current')).toBe('date');
		expect(cellOf(v, '2026-11-10')?.classList.contains('is-today')).toBe(false);
	});
});

describe('month steps over a year (F16)', () => {
	it('shiftMonth goes back and forward over the year end', () => {
		expect(shiftMonth(2026, 1, -1)).toEqual({ y: 2025, m: 12 });
		expect(shiftMonth(2026, 1, -13)).toEqual({ y: 2024, m: 12 });
		expect(shiftMonth(2026, 3, -2)).toEqual({ y: 2026, m: 1 });
		expect(shiftMonth(2026, 12, 1)).toEqual({ y: 2027, m: 1 });
		expect(shiftMonth(0, 1, -1)).toEqual({ y: -1, m: 12 });
	});

	it('the previous month button in January shows December of the year before', async () => {
		const { v } = await view({});
		v.showMonth(2026, 1);
		await settle();
		v.contentEl.querySelector<HTMLElement>('[aria-label="Previous month"]')?.click();
		await settle();
		expect(v.shownMonth()).toEqual({ y: 2025, m: 12 });
		expect(cellOf(v, '2025-12-31')).toBeTruthy();
	});
});

describe('heat values below zero and with decimals (R1A P3)', () => {
	it('numberFromProperty keeps the minus sign and the decimals', () => {
		expect(numberFromProperty('-3')).toBe(-3);
		expect(numberFromProperty(' -2.5 h')).toBe(-2.5);
		expect(numberFromProperty(['-1.25'])).toBe(-1.25);
		expect(numberFromProperty('7.5 h')).toBe(7.5);
		expect(numberFromProperty(-4)).toBe(-4);
		expect(numberFromProperty('- 3')).toBeNull();
	});

	it('a negative text value gets the lowest heat level, not no colour', () => {
		const values = ['-3', '0', '3'].map((v) => numberFromProperty(v));
		expect(heatLevels(values)).toEqual([1, 3, 4]);
	});
});
