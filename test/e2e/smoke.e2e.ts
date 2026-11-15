import { browser, expect } from '@wdio/globals';
import { pluginId, reloadPlugin } from './load';

describe(`${pluginId} smoke test`, function () {
	it('is enabled and reloads with no console errors', async function () {
		const state = await reloadPlugin(pluginId);
		expect(state).toEqual({ enabled: true, reloaded: true, errors: [] });
	});

	it('opens the calendar and creates today from a click', async function () {
		await browser.executeObsidianCommand(`${pluginId}:open`);
		const result = await browser.executeObsidian(async ({ app }) => {
			for (let i = 0; i < 50 && !document.querySelector('.mc-view .mc-day.is-today'); i++) await new Promise((r) => setTimeout(r, 100));
			const today = document.querySelector<HTMLElement>('.mc-view .mc-day.is-today');
			const rows = document.querySelectorAll('.mc-view .mc-grid .mc-row').length;
			today?.click();
			for (let i = 0; i < 50 && !app.workspace.getActiveFile(); i++) await new Promise((r) => setTimeout(r, 100));
			return { found: Boolean(today), rows, active: app.workspace.getActiveFile()?.basename ?? '' };
		});
		expect(result.found).toBe(true);
		expect(result.rows).toBeGreaterThanOrEqual(5);
		expect(result.active).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});
});
