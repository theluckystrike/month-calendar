// Phone checks in emulated mobile Obsidian. Run with OBSIDIAN_EMULATE_MOBILE=1 (see wdio.conf.mts). On desktop these tests skip.
import { browser, expect } from '@wdio/globals';
import { pluginId } from './load';

interface Fit {
	width: number;
	view: number;
	scroll: number;
	minDayWidth: number;
	minWeekWidth: number;
	minCellHeight: number;
}

/** Sets the window width, then measures the pane and the smallest day and week cells. The right drawer of a phone is 320 to 375 px wide. */
async function fitAt(width: number): Promise<Fit> {
	await browser.execute(async (w) => {
		await (window as unknown as { electron: { remote: { getCurrentWindow(): { setSize(a: number, b: number): Promise<void> } } } }).electron.remote.getCurrentWindow().setSize(w, 812);
	}, width);
	await browser.pause(700);
	return browser.executeObsidian(() => {
		const view = document.querySelector<HTMLElement>('.mc-view');
		const cells = Array.from(document.querySelectorAll<HTMLElement>('.mc-view .mc-grid .mc-cell'));
		const widths = (sel: string) => Array.from(document.querySelectorAll<HTMLElement>(sel)).map((c) => c.offsetWidth);
		return {
			width: window.innerWidth,
			view: view?.clientWidth ?? 0,
			scroll: view?.scrollWidth ?? 0,
			minDayWidth: Math.min(...widths('.mc-view .mc-grid .mc-day')),
			minWeekWidth: Math.min(...widths('.mc-view .mc-grid .mc-week')),
			minCellHeight: Math.min(...cells.map((c) => c.offsetHeight)),
		};
	});
}

describe(`${pluginId} on a phone`, function () {
	before(async function () {
		const mobile = await browser.executeObsidian(() => document.body.classList.contains('is-mobile'));
		if (!mobile) this.skip();
		await browser.executeObsidianCommand(`${pluginId}:open`);
		await browser.executeObsidian(async () => {
			for (let i = 0; i < 50 && !document.querySelector('.mc-view .mc-grid'); i++) await new Promise((r) => setTimeout(r, 100));
		});
	});

	for (const width of [320, 360, 375, 390, 412, 430]) {
		it(`fits the month with week numbers on a ${width} px phone with no side scroll`, async function () {
			const fit = await fitAt(width);
			expect(fit.width).toBe(width);
			expect(fit.view).toBeGreaterThan(0);
			expect(fit.scroll).toBeLessThanOrEqual(fit.view);
			// Tap targets stay 44 px high. The width is shared, and stays above the WCAG 2.5.8 minimum of 24 px.
			expect(fit.minDayWidth).toBeGreaterThanOrEqual(36);
			expect(fit.minWeekWidth).toBeGreaterThanOrEqual(24);
			expect(fit.minCellHeight).toBeGreaterThanOrEqual(44);
		});
	}

	it('opens the calendar in the open right drawer', async function () {
		const open = await browser.executeObsidian(({ app }) => !app.workspace.rightSplit.collapsed && Boolean(document.querySelector('.mc-view .mc-day.is-today')));
		expect(open).toBe(true);
	});
});
