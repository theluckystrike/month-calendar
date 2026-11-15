import { PluginSettingTab, type Notice, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems, redrawKeepFocus } from './license/github-obsidian';
import { helloSettingItems } from './hello/settings';
import { PRO_UI, isPro, proNotice } from './pro';
import { moment } from './obsidian-moment';
import { ISO_RULE, ruleFromLocale, type WeekRule } from './dates';
import { DEFAULT_FORMATS, TAG_COLORS } from './notes';
import type MonthCalendarPlugin from './main';

export type WeekStartSetting = 'locale' | '0' | '1' | '6';
export type FirstWeekSetting = 'locale' | 'iso' | 'jan1';

export interface MonthCalendarSettings {
	/** moment locale for month and weekday names, or "auto" for the language of Obsidian. */
	locale: string;
	weekStart: WeekStartSetting;
	firstWeek: FirstWeekSetting;
	showWeekNumbers: boolean;
	/** Ask before a click creates a note. */
	confirmCreate: boolean;
	/** "core" reads the core Daily notes settings; "custom" uses the three fields below. */
	dailySource: 'core' | 'custom';
	dailyFolder: string;
	dailyFormat: string;
	dailyTemplate: string;
	/** A note whose name starts with a date, for example "2026-11-10 Standup", counts for that day. */
	matchPrefix: boolean;
	weeklyFolder: string;
	weeklyFormat: string;
	weeklyTemplate: string;
	monthlyFolder: string;
	monthlyFormat: string;
	monthlyTemplate: string;
	quarterlyFolder: string;
	quarterlyFormat: string;
	quarterlyTemplate: string;
	yearlyFolder: string;
	yearlyFormat: string;
	yearlyTemplate: string;
	/** Pro: show the quarter and year cells under the month. */
	showQuarterRow: boolean;
	/** Pro: a number property that colours each day, '' for off. */
	heatProperty: string;
	/** Pro: "tag colour" lines that colour the dots. */
	tagColors: string;
	/** Pro: a date property that puts any note on its day, '' for off. */
	dateProperty: string;
	/** True after the plugin added its pane to the right sidebar one time. */
	paneAdded: boolean;
}

export const DEFAULT_SETTINGS: MonthCalendarSettings = {
	locale: 'auto',
	weekStart: 'locale',
	firstWeek: 'locale',
	showWeekNumbers: true,
	confirmCreate: false,
	dailySource: 'core',
	dailyFolder: '',
	dailyFormat: DEFAULT_FORMATS.day,
	dailyTemplate: '',
	matchPrefix: true,
	weeklyFolder: '',
	weeklyFormat: DEFAULT_FORMATS.week,
	weeklyTemplate: '',
	monthlyFolder: '',
	monthlyFormat: DEFAULT_FORMATS.month,
	monthlyTemplate: '',
	quarterlyFolder: '',
	quarterlyFormat: DEFAULT_FORMATS.quarter,
	quarterlyTemplate: '',
	yearlyFolder: '',
	yearlyFormat: DEFAULT_FORMATS.year,
	yearlyTemplate: '',
	showQuarterRow: false,
	heatProperty: '',
	tagColors: '',
	dateProperty: '',
	paneAdded: false,
};

/** Settings that only Pro saves. A free user sees the default value; the stored value stays for the time Pro comes back. */
export const PRO_KEYS = ['showQuarterRow', 'heatProperty', 'tagColors', 'dateProperty'] as const;
type ProKey = (typeof PRO_KEYS)[number];

/** First sentences of the Pro notices. */
export const PRO_LEADS = {
	showQuarterRow: 'Quarter and year cells are a Pro feature.',
	heatProperty: 'Heat colours are a Pro feature.',
	tagColors: 'Dot colours by tag are a Pro feature.',
	dateProperty: 'Dates from a property are a Pro feature.',
	quarterCell: 'Quarter and year cells are a Pro feature.',
} as const;

const WEEK_STARTS: Record<WeekStartSetting, string> = { locale: 'Locale default', '0': 'Sunday', '1': 'Monday', '6': 'Saturday' };
const FIRST_WEEKS: Record<FirstWeekSetting, string> = {
	locale: 'Locale default',
	iso: 'ISO 8601, the week with January 4',
	jan1: 'The week with January 1',
};

/** Fills gaps and drops bad values from saved data, so old or hand-edited data.json never breaks the plugin. */
export function normalizeSettings(saved: Partial<MonthCalendarSettings> | null | undefined): MonthCalendarSettings {
	const s = (saved ?? {}) as Record<string, unknown>;
	const out = { ...DEFAULT_SETTINGS } as Record<string, unknown>;
	for (const [key, def] of Object.entries(DEFAULT_SETTINGS)) {
		if (typeof s[key] === typeof def) out[key] = s[key];
	}
	const r = out as unknown as MonthCalendarSettings;
	if (!(r.weekStart in WEEK_STARTS)) r.weekStart = DEFAULT_SETTINGS.weekStart;
	if (!(r.firstWeek in FIRST_WEEKS)) r.firstWeek = DEFAULT_SETTINGS.firstWeek;
	if (r.dailySource !== 'core' && r.dailySource !== 'custom') r.dailySource = DEFAULT_SETTINGS.dailySource;
	if (!r.locale.trim()) r.locale = 'auto';
	for (const k of ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'] as const) {
		const key = `${k}Format` as const;
		if (!r[key].trim()) r[key] = DEFAULT_SETTINGS[key];
	}
	return r;
}

/** The moment locale in effect. "auto" is the language of Obsidian; an unknown code also falls back to it. */
export function effectiveLocale(settings: MonthCalendarSettings): string {
	const auto = moment.locale();
	if (settings.locale === 'auto') return auto;
	return moment.locales().includes(settings.locale) ? settings.locale : auto;
}

/** The week rule in effect from the settings and the locale. */
export function weekRule(settings: MonthCalendarSettings, locale: string): WeekRule {
	const data = moment.localeData(locale);
	const base = ruleFromLocale(data.firstDayOfWeek(), data.firstDayOfYear());
	const weekStart = settings.weekStart === 'locale' ? base.weekStart : Number(settings.weekStart);
	let minDays = base.minDays;
	if (settings.firstWeek === 'iso') minDays = ISO_RULE.minDays;
	if (settings.firstWeek === 'jan1') minDays = 1;
	return { weekStart, minDays };
}

/** The value of a Pro setting in effect. Without Pro: the default. */
export function proValue<K extends ProKey>(settings: MonthCalendarSettings, key: K, pro: boolean): MonthCalendarSettings[K] {
	return pro ? settings[key] : DEFAULT_SETTINGS[key];
}

function periodGroup(label: string, k: 'weekly' | 'monthly' | 'quarterly' | 'yearly', extra: string): SettingDefinitionItem {
	return {
		type: 'group',
		heading: `${label} notes`,
		items: [
			{
				name: 'Folder',
				desc: `The folder of the ${label.toLowerCase()} notes. Leave it empty for the vault root.`,
				control: { type: 'folder', key: `${k}Folder`, defaultValue: '' },
			},
			{
				name: 'Name format',
				desc: `A moment format. ${extra}`,
				control: { type: 'text', key: `${k}Format`, defaultValue: DEFAULT_SETTINGS[`${k}Format`], placeholder: DEFAULT_SETTINGS[`${k}Format`] },
			},
			{
				name: 'Template',
				desc: 'A note that a new note copies. Leave it empty for an empty note.',
				control: { type: 'file', key: `${k}Template`, defaultValue: '' },
			},
		],
	};
}

export class MonthCalendarSettingTab extends PluginSettingTab {
	/** The last Pro notice of this tab. The same notice does not show again while it is open. */
	private notice: Notice | null = null;
	plugin: MonthCalendarPlugin;

	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], plugin: MonthCalendarPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		// The product rows, then the "More from NoteMods" card (packages/hello).
		return [...this.productSettingDefinitions(), ...helloSettingItems()];
	}

	productSettingDefinitions(): SettingDefinitionItem[] {
		const locales: Record<string, string> = { auto: 'Same as Obsidian' };
		for (const l of moment.locales()) locales[l] = l;
		const custom = () => this.plugin.settings.dailySource === 'custom';
		return [
			{
				type: 'group',
				heading: 'Calendar',
				items: [
					{
						name: 'Locale',
						desc: 'The language of the month and weekday names. The locale also gives the default week start.',
						control: { type: 'dropdown', key: 'locale', defaultValue: 'auto', options: locales },
					},
					{
						name: 'Week start',
						desc: 'The first day of each row.',
						control: { type: 'dropdown', key: 'weekStart', defaultValue: DEFAULT_SETTINGS.weekStart, options: { ...WEEK_STARTS } },
					},
					{
						name: 'First week of the year',
						desc: 'The rule for week 1. ISO 8601 is usual in Europe. The week with January 1 is usual in the United States.',
						control: { type: 'dropdown', key: 'firstWeek', defaultValue: DEFAULT_SETTINGS.firstWeek, options: { ...FIRST_WEEKS } },
					},
					{
						name: 'Show week numbers',
						desc: 'A column with the week number. Select a week number to open or create the weekly note.',
						control: { type: 'toggle', key: 'showWeekNumbers', defaultValue: DEFAULT_SETTINGS.showWeekNumbers },
					},
					{
						name: 'Ask before you create a note',
						desc: 'When this is on, a click on a day without a note asks first.',
						control: { type: 'toggle', key: 'confirmCreate', defaultValue: DEFAULT_SETTINGS.confirmCreate },
					},
				],
			},
			{
				type: 'group',
				heading: 'Daily notes',
				items: [
					{
						name: 'Source of the settings',
						desc: 'Core Daily notes uses the folder, format and template of the core Daily notes settings.',
						control: { type: 'dropdown', key: 'dailySource', defaultValue: 'core', options: { core: 'Core Daily notes', custom: 'Custom' } },
					},
					{
						name: 'Folder',
						desc: 'Custom only. Notes in subfolders of this folder also count.',
						control: { type: 'folder', key: 'dailyFolder', defaultValue: '', disabled: () => !custom() },
					},
					{
						name: 'Name format',
						desc: 'Custom only. A moment format, for example YYYY-MM-DD or YYYY/MM/YYYY-MM-DD.',
						control: { type: 'text', key: 'dailyFormat', defaultValue: DEFAULT_SETTINGS.dailyFormat, placeholder: DEFAULT_FORMATS.day, disabled: () => !custom() },
					},
					{
						name: 'Template',
						desc: 'Custom only. A note that a new daily note copies.',
						control: { type: 'file', key: 'dailyTemplate', defaultValue: '', disabled: () => !custom() },
					},
					{
						name: 'Match a date at the start of the name',
						desc: 'A note named "2026-11-10 Standup" counts for 10 November.',
						control: { type: 'toggle', key: 'matchPrefix', defaultValue: DEFAULT_SETTINGS.matchPrefix },
					},
				],
			},
			periodGroup('Weekly', 'weekly', 'gggg and ww are the week year and the week number of the calendar rows.'),
			periodGroup('Monthly', 'monthly', 'Select the month name above the calendar to open or create the note.'),
			periodGroup('Yearly', 'yearly', 'Select the year above the calendar to open or create the note.'),
			periodGroup('Quarterly', 'quarterly', 'Pro shows the quarter cells under the month.'),
			{
				type: 'group',
				heading: 'Pro',
				items: [
					{
						name: 'Show quarter and year cells',
						desc: 'Pro. A row under the month with Q1 to Q4 and the year. Each cell opens or creates its note and shows a dot when the note exists.',
						control: { type: 'toggle', key: 'showQuarterRow', defaultValue: false },
					},
					{
						name: 'Heat colour property',
						desc: 'Pro. A number property of the daily notes, for example mood or sleep. Days with a higher value get a stronger colour.',
						control: { type: 'text', key: 'heatProperty', defaultValue: '', placeholder: 'mood' },
					},
					{
						name: 'Dot colours by tag',
						desc: `Pro. One rule on each line, a tag and a colour, for example #work blue. Colours are ${TAG_COLORS.join(', ')}.`,
						control: { type: 'textarea', key: 'tagColors', defaultValue: '', placeholder: '#work blue', rows: 3 },
					},
					{
						name: 'Date property',
						desc: 'Pro. A note with this property, for example date, shows as a dot on that day.',
						control: { type: 'text', key: 'dateProperty', defaultValue: '', placeholder: 'date' },
					},
					{
						name: 'Pro features',
						desc: isPro()
							? 'Pro is on. The quarter and year cells, heat colours, tag colours and the date property work.'
							: 'Free version has the month calendar with dots, week numbers, weekly, monthly and yearly notes, locales and week rules. Pro adds the four rows above.',
					},
				],
			},
			// The Pro group comes after the settings of the plugin.
			...(this.plugin.pro ? sponsorsSettingItems(this.plugin.pro, PRO_UI) : []),
		];
	}

	getControlValue(key: string): unknown {
		// A free user sees the value in effect. The stored value stays for the time that Pro comes back.
		if ((PRO_KEYS as readonly string[]).includes(key) && !isPro()) return DEFAULT_SETTINGS[key as ProKey];
		return super.getControlValue(key);
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		if ((PRO_KEYS as readonly string[]).includes(key) && !isPro()) {
			// Free users can use the Pro settings: the notice shows what Pro adds and how to get it. Nothing is saved.
			if (!this.notice?.messageEl.isConnected) this.notice = proNotice(PRO_LEADS[key as ProKey]);
			redrawKeepFocus(this);
			return;
		}
		await super.setControlValue(key, value);
		this.plugin.settings = normalizeSettings(this.plugin.settings);
		this.update();
		this.plugin.refreshViews(true);
	}
}
