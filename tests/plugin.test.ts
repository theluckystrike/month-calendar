import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, SettingTab, moment } from 'obsidian-test-mocks/obsidian';
import MonthCalendarPlugin from '../src/main';
import { DEFAULT_SETTINGS, MonthCalendarSettingTab, PRO_KEYS, PRO_LEADS, normalizeSettings, proValue, weekRule } from '../src/settings';
import { bindPro, resetPro } from '../src/pro';
import manifest from '../manifest.json';

function tab(): { t: MonthCalendarSettingTab; plugin: MonthCalendarPlugin; refresh: ReturnType<typeof vi.fn> } {
	const app = App.createConfigured__({ files: {} });
	const plugin = new MonthCalendarPlugin(app as never, manifest as never);
	const refresh = vi.fn();
	plugin.refreshViews = refresh;
	const t = new MonthCalendarSettingTab(app as never, plugin);
	vi.spyOn(t, 'update').mockImplementation(() => undefined);
	return { t, plugin, refresh };
}

describe('MonthCalendarPlugin', () => {
	afterEach(() => {
		resetPro();
		vi.restoreAllMocks();
	});

	it('loads with default settings against an in-memory vault', async () => {
		const app = App.createConfigured__({ files: { 'notes/a.md': '# Hello world' } });
		const plugin = new MonthCalendarPlugin(app as never, manifest as never);
		await plugin.loadSettings();
		expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
	});

	it('repairs bad saved settings', () => {
		expect(normalizeSettings({ weekStart: '3' as never, firstWeek: 'x' as never, showWeekNumbers: 'yes' as never, dailyFormat: '  ', locale: '' })).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings({ weekStart: '1', dailySource: 'custom' }).weekStart).toBe('1');
	});

	it('reads the core Daily notes settings from the config folder', async () => {
		const app = App.createConfigured__({ files: {} });
		const plugin = new MonthCalendarPlugin(app as never, manifest as never);
		const adapter = app.vault.adapter as unknown as { exists: (p: string) => Promise<boolean>; read: (p: string) => Promise<string> };
		vi.spyOn(adapter, 'exists').mockResolvedValue(true);
		const read = vi.spyOn(adapter, 'read').mockResolvedValue(JSON.stringify({ folder: 'Daily', format: 'DD.MM.YYYY', template: 'T/Day' }));
		expect(await plugin.readDaily()).toEqual({ folder: 'Daily', format: 'DD.MM.YYYY', template: 'T/Day' });
		expect(read).toHaveBeenCalledWith(`${app.vault.configDir}/daily-notes.json`);
		expect(plugin.pathOf('day', '2026-11-10')).toBe('Daily/10.11.2026.md');
		read.mockResolvedValue('{broken');
		expect(await plugin.readDaily()).toEqual({ folder: '', format: 'YYYY-MM-DD', template: '' });
	});

	it('uses the custom daily note fields when the source is custom', async () => {
		const { plugin } = tab();
		plugin.settings = normalizeSettings({ dailySource: 'custom', dailyFolder: '/Journal/', dailyFormat: 'YYYY/YYYY-MM-DD' });
		await plugin.readDaily();
		expect(plugin.pathOf('day', '2026-11-10')).toBe('Journal/2026/2026-11-10.md');
		expect(plugin.pathOf('month', '2026-11-10')).toBe('2026-11.md');
	});

	it('takes the week start and the first week from the locale or the settings', () => {
		const prev = moment.locale();
		moment.defineLocale('mc-plugin-de', { week: { dow: 1, doy: 4 } });
		moment.locale(prev);
		expect(weekRule(DEFAULT_SETTINGS, 'en')).toEqual({ weekStart: 0, minDays: 1 });
		expect(weekRule(DEFAULT_SETTINGS, 'mc-plugin-de')).toEqual({ weekStart: 1, minDays: 4 });
		expect(weekRule({ ...DEFAULT_SETTINGS, weekStart: '1', firstWeek: 'iso' }, 'en')).toEqual({ weekStart: 1, minDays: 4 });
		expect(weekRule({ ...DEFAULT_SETTINGS, weekStart: '6', firstWeek: 'jan1' }, 'mc-plugin-de')).toEqual({ weekStart: 6, minDays: 1 });
	});

	it('names the Pro feature in each lead', () => {
		for (const key of PRO_KEYS) expect(PRO_LEADS[key]).toMatch(/Pro feature\.$/);
	});

	it('gives the defaults of the Pro settings without Pro and keeps the stored values', () => {
		const s = { ...DEFAULT_SETTINGS, heatProperty: 'mood', showQuarterRow: true };
		expect(proValue(s, 'heatProperty', false)).toBe('');
		expect(proValue(s, 'showQuarterRow', false)).toBe(false);
		expect(proValue(s, 'heatProperty', true)).toBe('mood');
	});

	it('a free user who changes a Pro setting saves nothing and sees the default', async () => {
		const { t, plugin, refresh } = tab();
		const save = vi.spyOn(SettingTab.prototype, 'setControlValue');
		plugin.settings = { ...DEFAULT_SETTINGS, heatProperty: 'Kept' };
		for (const key of PRO_KEYS) await t.setControlValue(key, key === 'showQuarterRow' ? true : 'x');
		expect(save).not.toHaveBeenCalled();
		expect(refresh).not.toHaveBeenCalled();
		expect(plugin.settings.heatProperty).toBe('Kept');
		expect(t.getControlValue('heatProperty')).toBe('');
		expect(t.getControlValue('showQuarterRow')).toBe(false);
	});

	it('a free user can change the week start, week numbers and note formats', async () => {
		const { t, refresh } = tab();
		const save = vi.spyOn(SettingTab.prototype, 'setControlValue').mockImplementation(async () => undefined);
		await t.setControlValue('weekStart', '1');
		await t.setControlValue('weeklyFormat', 'GGGG-[W]WW');
		expect(save).toHaveBeenCalledWith('weekStart', '1');
		expect(save).toHaveBeenCalledWith('weeklyFormat', 'GGGG-[W]WW');
		expect(refresh).toHaveBeenCalledTimes(2);
	});

	it('a Pro user saves the Pro settings', async () => {
		bindPro({ isPro: () => true, onChange: () => () => undefined } as never);
		const { t, refresh } = tab();
		const save = vi.spyOn(SettingTab.prototype, 'setControlValue').mockImplementation(async () => undefined);
		await t.setControlValue('heatProperty', 'mood');
		expect(save).toHaveBeenCalledWith('heatProperty', 'mood');
		expect(refresh).toHaveBeenCalledWith(true);
	});

	it('lists the free and the Pro settings', () => {
		const { t } = tab();
		const text = JSON.stringify(t.productSettingDefinitions());
		for (const name of ['Week start', 'First week of the year', 'Show week numbers', 'Match a date at the start of the name', 'Show quarter and year cells', 'Heat colour property', 'Dot colours by tag', 'Date property']) expect(text).toContain(name);
	});
});
