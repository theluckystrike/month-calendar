// Behaviour checks in a real Obsidian. Month buttons, dots from notes, the exact note on a click, week numbers and a narrow pane.
import { browser, expect } from '@wdio/globals';
import { pluginId } from './load';

/** Opens the calendar and waits until the grid shows. */
async function openCalendar(): Promise<void> {
	await browser.executeObsidianCommand(`${pluginId}:open`);
	await browser.executeObsidian(async () => {
		for (let i = 0; i < 50 && !document.querySelector('.mc-view .mc-grid'); i++) await new Promise((r) => setTimeout(r, 100));
	});
}

/** The aria label of the grid, for example "November 2026". */
async function gridLabel(): Promise<string> {
	return browser.executeObsidian(() => document.querySelector('.mc-view .mc-grid')?.getAttribute('aria-label') ?? '');
}

/** Clicks the button of the calendar with this aria label, then waits for the next draw. */
async function clickNav(label: string): Promise<void> {
	await browser.executeObsidian(async (_o, l) => {
		document.querySelector<HTMLElement>(`.mc-view .mc-nav-button[aria-label="${l}"]`)?.click();
		await new Promise((r) => setTimeout(r, 200));
	}, label);
}

/** A day of the shown month (day 3, so it is never in another month). */
async function dayOfMonth(): Promise<string> {
	return browser.executeObsidian(() => {
		const today = document.querySelector<HTMLElement>('.mc-view .mc-day.is-today')?.dataset.date ?? '';
		return `${today.slice(0, 8)}03`;
	});
}

/** Dots, task dot and note flag of one day cell, after the update delay of the view. */
async function cellState(iso: string): Promise<{ dots: number; task: boolean; note: boolean }> {
	return browser.executeObsidian(async (_o, d) => {
		await new Promise((r) => setTimeout(r, 900));
		const cell = document.querySelector<HTMLElement>(`.mc-view .mc-day[data-date="${d}"]`);
		return {
			dots: cell?.querySelectorAll('.mc-dot:not(.mc-dot-task)').length ?? -1,
			task: Boolean(cell?.querySelector('.mc-dot-task')),
			note: Boolean(cell?.classList.contains('has-note')),
		};
	}, iso);
}

describe(`${pluginId} behaviour`, function () {
	before(async function () {
		await openCalendar();
	});

	it('moves to the next and previous month and back to today', async function () {
		const start = await gridLabel();
		await clickNav('Next month');
		const next = await gridLabel();
		await clickNav('Previous month');
		const back = await gridLabel();
		await clickNav('Previous month');
		const prev = await gridLabel();
		await clickNav('Next month');
		const forth = await gridLabel();
		await clickNav('Next month');
		await clickNav('Show this month');
		expect(next).not.toBe(start);
		expect(back).toBe(start);
		expect(prev).not.toBe(start);
		expect(prev).not.toBe(next);
		expect(forth).toBe(start);
		expect(await gridLabel()).toBe(start);
	});

	it('adds dots for a note with words and a task dot for an open task, and removes them on a delete', async function () {
		const iso = await dayOfMonth();
		const words = Array.from({ length: 400 }, (_, i) => `word${i}`).join(' ');
		await browser.executeObsidian(async ({ app }, d, w) => {
			await app.vault.create(`${d}.md`, `${w}\n\n- [ ] open task\n`);
		}, iso, words);
		const filled = await cellState(iso);
		await browser.executeObsidian(async ({ app }, d) => {
			const f = app.vault.getFileByPath(`${d}.md`);
			if (f) await app.vault.delete(f);
		}, iso);
		const empty = await cellState(iso);
		expect(filled.note).toBe(true);
		expect(filled.dots).toBeGreaterThanOrEqual(1);
		expect(filled.task).toBe(true);
		expect(empty).toEqual({ dots: 0, task: false, note: false });
	});

	it('opens the exact daily note and not a note that only starts with the date', async function () {
		const iso = await dayOfMonth();
		const result = await browser.executeObsidian(async ({ app }, d) => {
			await app.vault.create(`${d} meeting.md`, 'notes of the meeting');
			await new Promise((r) => setTimeout(r, 900));
			const prefixDots = document.querySelectorAll(`.mc-view .mc-day[data-date="${d}"] .mc-dot`).length;
			document.querySelector<HTMLElement>(`.mc-view .mc-day[data-date="${d}"]`)?.click();
			for (let i = 0; i < 50 && app.workspace.getActiveFile()?.path !== `${d}.md`; i++) await new Promise((r) => setTimeout(r, 100));
			const active = app.workspace.getActiveFile()?.path ?? '';
			document.querySelector<HTMLElement>(`.mc-view .mc-day[data-date="${d}"]`)?.click();
			await new Promise((r) => setTimeout(r, 500));
			const copies = app.vault.getMarkdownFiles().filter((f) => f.basename.startsWith(d)).length;
			return { prefixDots, active, copies };
		}, iso);
		expect(result.prefixDots).toBeGreaterThanOrEqual(1);
		expect(result.active).toBe(`${iso}.md`);
		expect(result.copies).toBe(2);
	});

	it('shows one week number for each row and hides them when the setting is off', async function () {
		const result = await browser.executeObsidian(async ({ app }, id) => {
			const plugin = (app as unknown as { plugins: { plugins: Record<string, { settings: { showWeekNumbers: boolean }; refreshViews(r?: boolean): void }> } }).plugins.plugins[id]!;
			const count = () => ({
				rows: document.querySelectorAll('.mc-view .mc-grid .mc-row:not(.mc-head)').length,
				weeks: document.querySelectorAll('.mc-view .mc-week').length,
			});
			plugin.settings.showWeekNumbers = true;
			plugin.refreshViews();
			await new Promise((r) => setTimeout(r, 300));
			const on = count();
			plugin.settings.showWeekNumbers = false;
			plugin.refreshViews();
			await new Promise((r) => setTimeout(r, 300));
			const off = count();
			plugin.settings.showWeekNumbers = true;
			plugin.refreshViews();
			return { on, off };
		}, pluginId);
		expect(result.on.weeks).toBe(result.on.rows);
		expect(result.off.weeks).toBe(0);
	});

	it('fits the grid in the narrowest sidebar pane with no horizontal scroll', async function () {
		// A phone has no resizable sidebar. mobile.e2e.ts checks phone widths.
		if (await browser.executeObsidian(() => document.body.classList.contains('is-mobile'))) this.skip();
		const result = await browser.executeObsidian(async () => {
			const view = document.querySelector<HTMLElement>('.mc-view');
			const holder = view?.closest<HTMLElement>('.workspace-leaf') ?? view;
			const old = holder?.style.width ?? '';
			if (holder) holder.style.width = '250px';
			await new Promise((r) => setTimeout(r, 200));
			const grid = document.querySelector<HTMLElement>('.mc-view .mc-grid');
			const out = { view: view?.clientWidth ?? 0, scroll: view?.scrollWidth ?? 0, grid: grid?.scrollWidth ?? 0 };
			if (holder) holder.style.width = old;
			return out;
		});
		// The sidebar keeps a minimum width, so a request of 250 px gives a pane of about 300 px.
		expect(result.view).toBeGreaterThan(0);
		expect(result.view).toBeLessThanOrEqual(320);
		expect(result.scroll).toBeLessThanOrEqual(result.view);
	});
});
