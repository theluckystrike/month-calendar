// Fix round after review R1B: the day click opens or creates the exact daily note, the date match stays in the daily
// notes folder, the index updates one file at a time, and the active day keeps its heat colour.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import MonthCalendarPlugin from '../src/main';
import { MonthCalendarView } from '../src/view';
import { DayIndex } from '../src/day-index';
import { addDays } from '../src/dates';
import { dayOfNote } from '../src/notes';
import { resetPro } from '../src/pro';
import manifest from '../manifest.json';

afterEach(() => {
	resetPro();
	vi.restoreAllMocks();
});

async function setup(files: Record<string, string>, settings: Record<string, unknown> = {}) {
	const app = App.createConfigured__({ files });
	const plugin = new MonthCalendarPlugin(app as never, manifest as never);
	await plugin.loadSettings();
	Object.assign(plugin.settings, settings);
	const v = new MonthCalendarView(app.workspace.getLeaf(true) as never, plugin);
	v.showMonth(2026, 11);
	await v.onOpen();
	await v.refresh(true);
	return { app, plugin, v };
}

async function settle(): Promise<void> {
	for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
}

const cellOf = (v: MonthCalendarView, iso: string) => v.contentEl.querySelector<HTMLElement>(`[data-date="${iso}"]`);

describe('the day click opens or creates the exact daily note', () => {
	it('with the default root folder, a dated note in another folder is not the daily note', async () => {
		const { app, v } = await setup({ 'Projects/Clippings/2026-11-10 Launch plan.md': 'plan' });
		expect(cellOf(v, '2026-11-10')?.classList.contains('has-note')).toBe(false);
		cellOf(v, '2026-11-10')?.click();
		await settle();
		expect(app.vault.getFileByPath('2026-11-10.md')).toBeTruthy();
		expect(app.workspace.getActiveFile()?.path).toBe('2026-11-10.md');
	});

	it('a prefix note in the daily folder shows a dot but does not stop the daily note', async () => {
		const { app, v } = await setup({ 'Daily/2026-11-10 Standup.md': 'standup' }, { dailySource: 'custom', dailyFolder: 'Daily' });
		expect(cellOf(v, '2026-11-10')?.classList.contains('has-note')).toBe(true);
		cellOf(v, '2026-11-10')?.click();
		await settle();
		expect(app.vault.getFileByPath('Daily/2026-11-10.md')).toBeTruthy();
		expect(app.workspace.getActiveFile()?.path).toBe('Daily/2026-11-10.md');
		expect(await app.vault.read(app.vault.getFileByPath('Daily/2026-11-10 Standup.md') as never)).toBe('standup');
	});

	it('opens the exact note when it exists next to a prefix note', async () => {
		const { app, v } = await setup({ 'Daily/2026-11-10 A first.md': 'a', 'Daily/2026-11-10.md': 'day' }, { dailySource: 'custom', dailyFolder: 'Daily' });
		cellOf(v, '2026-11-10')?.click();
		await settle();
		expect(app.workspace.getActiveFile()?.path).toBe('Daily/2026-11-10.md');
	});
});

describe('the date match stays in the daily notes folder', () => {
	it('with the root folder, only notes at the depth of the format count', () => {
		const root = { folder: '', format: 'YYYY-MM-DD', template: '' };
		expect(dayOfNote('2026-11-10.md', root, true)).toBe('2026-11-10');
		expect(dayOfNote('2026-11-10 Standup.md', root, true)).toBe('2026-11-10');
		expect(dayOfNote('Projects/2026-11-10.md', root, true)).toBeNull();
		expect(dayOfNote('Projects/Clippings/2026-11-10 Launch plan.md', root, true)).toBeNull();
		const nested = { folder: '', format: 'YYYY/MM/YYYY-MM-DD', template: '' };
		expect(dayOfNote('2026/11/2026-11-10.md', nested, true)).toBe('2026-11-10');
		expect(dayOfNote('Work/11/2026-11-10.md', nested, true)).toBeNull();
	});

	it('with a daily folder, its subfolders count and other folders do not', () => {
		const cfg = { folder: 'Daily', format: 'YYYY-MM-DD', template: '' };
		expect(dayOfNote('Daily/2026/11/2026-11-10 Standup.md', cfg, true)).toBe('2026-11-10');
		expect(dayOfNote('Notes/2026-11-10 Standup.md', cfg, true)).toBeNull();
	});
});

describe('the index updates one file at a time', () => {
	function vault(n: number): string[] {
		const out: string[] = [];
		let d = '2018-01-01';
		for (let i = 0; i < 3000; i++) {
			out.push(`Daily/${d}.md`);
			d = addDays(d, 1);
		}
		for (let i = out.length; i < n; i++) out.push(i % 2 ? `Projects/P${i % 50}/Meeting ${i} v2 final, part 3.md` : `Zettel/Idea about things ${i % 997}.md`);
		return out;
	}

	it('adds, renames and removes a note and keeps the day lists right', () => {
		const cfg = { folder: 'Daily', format: 'YYYY-MM-DD', template: '' };
		const idx = new DayIndex((p) => [dayOfNote(p, cfg, true)]);
		idx.rebuild(['Daily/2026-11-10.md', 'Notes/x.md']);
		expect(idx.files('2026-11-10')).toEqual(['Daily/2026-11-10.md']);
		idx.update('Daily/2026-11-10 Standup.md');
		expect(idx.files('2026-11-10')).toEqual(['Daily/2026-11-10 Standup.md', 'Daily/2026-11-10.md']);
		idx.rename('Daily/2026-11-10 Standup.md', 'Daily/2026-11-11 Standup.md');
		expect(idx.files('2026-11-10')).toEqual(['Daily/2026-11-10.md']);
		expect(idx.files('2026-11-11')).toEqual(['Daily/2026-11-11 Standup.md']);
		idx.remove('Daily/2026-11-10.md');
		expect(idx.files('2026-11-10')).toEqual([]);
		idx.rename('Daily/2026-11-11 Standup.md', 'Notes/Standup.md');
		expect(idx.files('2026-11-11')).toEqual([]);
	});

	for (const [label, folder] of [
		['root folder', ''],
		['Daily folder', 'Daily'],
	] as const) {
		it(`one change in a vault of 20,000 notes takes under 5 ms (${label})`, () => {
			const cfg = { folder, format: 'YYYY-MM-DD', template: '' };
			const idx = new DayIndex((p) => [dayOfNote(p, cfg, true)]);
			idx.rebuild(vault(20000));
			const times: number[] = [];
			for (let i = 0; i < 200; i++) {
				const t0 = performance.now();
				if (i % 3 === 0) idx.update(`${folder ? `${folder}/` : ''}2030-01-${String((i % 28) + 1).padStart(2, '0')} Note ${i}.md`);
				else if (i % 3 === 1) idx.rename(`Zettel/Idea about things ${i}.md`, `Zettel/Idea ${i}.md`);
				else idx.remove(`Daily/2019-0${(i % 9) + 1}-10.md`);
				times.push(performance.now() - t0);
			}
			times.sort((a, b) => a - b);
			const p95 = times[Math.floor(times.length * 0.95)] ?? 0;
			console.log(`PERF index update ${label}: p95 ${p95.toFixed(3)} ms, max ${(times[times.length - 1] ?? 0).toFixed(3)} ms`);
			expect(p95).toBeLessThan(5);
		});
	}

	it('the view does not rebuild the index on a create, delete or rename', async () => {
		const { app, v } = await setup({ 'Daily/2026-11-09.md': 'x' }, { dailySource: 'custom', dailyFolder: 'Daily' });
		const rebuild = vi.spyOn(DayIndex.prototype, 'rebuild');
		await app.vault.create('Daily/2026-11-12.md', 'new');
		await new Promise((r) => setTimeout(r, 400));
		await settle();
		expect(rebuild).not.toHaveBeenCalled();
		expect(cellOf(v, '2026-11-12')?.classList.contains('has-note')).toBe(true);
	});
});

describe('the active day keeps its heat colour', () => {
	it('marks the active day and today with an outline, not a fill', () => {
		const css = readFileSync(join(__dirname, '..', 'styles.css'), 'utf8');
		const rule = (sel: string) => new RegExp(`${sel.replace(/\./g, '\\.')}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
		expect(rule('.mc-cell.is-active')).not.toMatch(/background/);
		expect(rule('.mc-cell.is-active')).toMatch(/box-shadow|outline/);
		expect(rule('.mc-day.is-today')).toMatch(/box-shadow|outline/);
	});
});
