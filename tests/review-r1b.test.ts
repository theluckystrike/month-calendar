// R1B review tests: they close 4 gaps that planted faults showed (F2, F5, F6, F9).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import MonthCalendarPlugin from '../src/main';
import { dayOfNote, fillTemplate } from '../src/notes';
import { MonthCalendarView } from '../src/view';
import { bindPro, resetPro } from '../src/pro';
import manifest from '../manifest.json';

afterEach(() => {
	resetPro();
	vi.restoreAllMocks();
});

describe('R1B daily note folder scope', () => {
	it('ignores a dated note outside the daily folder', () => {
		const core = { folder: 'Daily', format: 'YYYY-MM-DD', template: '' };
		expect(dayOfNote('Archive/2026-11-10.md', core, false)).toBeNull();
		expect(dayOfNote('Dailyx/2026-11-10.md', core, true)).toBeNull();
	});
});

describe('R1B template date', () => {
	it('fills {{date}} with the day of the note, not today', () => {
		const now = new Date(2026, 10, 10, 9, 5);
		expect(fillTemplate('{{date}} {{date:dddd}}', 't', '2026-11-03', now, 'YYYY-MM-DD')).toBe('2026-11-03 Tuesday');
	});
});

describe('R1B create never overwrites', () => {
	it('opens the existing note and keeps its text, also when the index is stale', async () => {
		const app = App.createConfigured__({ files: { '2026-11-10.md': 'keep me' } });
		const plugin = new MonthCalendarPlugin(app as never, manifest as never);
		await plugin.loadSettings();
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		await plugin.openPeriod('day', '2026-11-10', false);
		// A stale index: the lookup misses, so the plugin tries to create the note.
		vi.spyOn(app.vault, 'getFileByPath').mockReturnValue(null);
		await plugin.openPeriod('day', '2026-11-10', false);
		vi.restoreAllMocks();
		const f = app.vault.getFileByPath('2026-11-10.md');
		expect(f).toBeTruthy();
		expect(await app.vault.read(f as never)).toBe('keep me');
	});

	it('creates a missing daily note in a nested folder', async () => {
		const app = App.createConfigured__({ files: {} });
		const plugin = new MonthCalendarPlugin(app as never, manifest as never);
		await plugin.loadSettings();
		plugin.settings.dailySource = 'custom';
		plugin.settings.dailyFormat = 'YYYY/MM/YYYY-MM-DD';
		plugin.settings.dailyFolder = 'Journal';
		await plugin.openPeriod('day', '2026-11-10', false);
		expect(app.vault.getFileByPath('Journal/2026/11/2026-11-10.md')).toBeTruthy();
	});
});

describe('R1B quarter cells are Pro', () => {
	async function view(pro: boolean) {
		const app = App.createConfigured__({ files: {} });
		const plugin = new MonthCalendarPlugin(app as never, manifest as never);
		await plugin.loadSettings();
		plugin.settings.showQuarterRow = true;
		bindPro({ isPro: () => pro, onChange: () => () => undefined } as never);
		const leaf = app.workspace.getLeaf(true);
		const v = new MonthCalendarView(leaf as never, plugin);
		await v.onOpen();
		const open = vi.spyOn(plugin, 'openPeriod').mockResolvedValue(undefined);
		return { v, open };
	}

	it('a free user sees no quarter cells and a stray click opens nothing', async () => {
		const { v, open } = await view(false);
		expect(v.contentEl.querySelectorAll('.mc-quarter').length).toBe(0);
		// The title year button is free.
		(v.contentEl.querySelector('.mc-year') as HTMLElement).click();
		expect(open).toHaveBeenCalledWith('year', expect.any(String), false, undefined);
	});

	it('a Pro user sees Q1 to Q4 and a click opens the quarter note', async () => {
		const { v, open } = await view(true);
		const cells = v.contentEl.querySelectorAll<HTMLElement>('.mc-quarter');
		expect(cells.length).toBe(4);
		cells[0]?.click();
		expect(open).toHaveBeenCalledWith('quarter', expect.stringMatching(/-01-01$/), false, undefined);
	});

	it('the click handler of a quarter cell checks Pro at click time (Pro ended after draw)', async () => {
		let pro = true;
		const app = App.createConfigured__({ files: {} });
		const plugin = new MonthCalendarPlugin(app as never, manifest as never);
		await plugin.loadSettings();
		plugin.settings.showQuarterRow = true;
		bindPro({ isPro: () => pro, onChange: () => () => undefined } as never);
		const v = new MonthCalendarView(app.workspace.getLeaf(true) as never, plugin);
		await v.onOpen();
		const open = vi.spyOn(plugin, 'openPeriod').mockResolvedValue(undefined);
		pro = false;
		resetPro(); // no manager: isPro() is false and the notice is a plain Notice
		v.contentEl.querySelector<HTMLElement>('.mc-quarter')?.click();
		expect(open).not.toHaveBeenCalled();
	});
});
