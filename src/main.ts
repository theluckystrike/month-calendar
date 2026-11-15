import { Modal, Notice, Plugin, Setting, TFile, normalizePath, type App, type PaneType, type WorkspaceLeaf } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { setupHello } from './hello/index';
import { SPONSORS, bindPro, onProChange, resetPro } from './pro';
import { DEFAULT_SETTINGS, MonthCalendarSettingTab, effectiveLocale, normalizeSettings, weekRule, type MonthCalendarSettings } from './settings';
import { cleanFolder, dailyFromCore, fillTemplate, periodName, periodPath, templatePath, type Period, type PeriodConfig } from './notes';
import { localIso, type IsoDate, type WeekRule } from './dates';
import { MonthCalendarView, VIEW_TYPE } from './view';
import WHATS_NEW from './whats-new.json';

/** How often to ask the license state whether a check is due. It sends a request only when signed in and due (7 days). */
const PRO_TICK_MS = 6 * 60 * 60 * 1000;

const NAMES: Record<Period, string> = { day: 'daily', week: 'weekly', month: 'monthly', quarter: 'quarterly', year: 'yearly' };

class ConfirmModal extends Modal {
	private done = false;
	constructor(
		app: App,
		private readonly text: string,
		private readonly resolve: (ok: boolean) => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle('Create a note');
		this.contentEl.createEl('p', { text: this.text });
		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText('Cancel').onClick(() => this.finish(false)))
			.addButton((b) =>
				b
					.setButtonText('Create')
					.setCta()
					.onClick(() => this.finish(true)),
			);
	}

	onClose(): void {
		this.contentEl.empty();
		if (!this.done) this.resolve(false);
	}

	private finish(ok: boolean): void {
		this.done = true;
		this.resolve(ok);
		this.close();
	}
}

export default class MonthCalendarPlugin extends Plugin {
	settings: MonthCalendarSettings = { ...DEFAULT_SETTINGS };
	/** GitHub Sponsors Pro state. Created in onload; null before that. */
	pro: SponsorsManager | null = null;
	/** The daily note settings in effect. readDaily() updates them from the core Daily notes settings. */
	daily: PeriodConfig = dailyFromCore(null);
	private settingTab: MonthCalendarSettingTab | null = null;

	async onload(): Promise<void> {
		// First: "What's new" reads its state before the settings load (packages/hello). It does not wait.
		setupHello(this, WHATS_NEW);
		await this.loadSettings();
		// No request here: a request needs a GitHub sign in first (Settings, Pro, Sign in with GitHub).
		const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
		pro.init();
		this.pro = pro;
		bindPro(pro);
		this.register(pro.onChange(() => this.settingTab?.update()));
		this.register(onProChange(() => this.refreshViews(true)));
		this.settingTab = new MonthCalendarSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);

		this.registerView(VIEW_TYPE, (leaf) => new MonthCalendarView(leaf, this));
		this.registerHoverLinkSource(VIEW_TYPE, { display: 'Month Calendar', defaultMod: true });
		this.addCommand({ id: 'open', name: 'Open calendar', callback: () => void this.activateView() });
		this.addCommand({ id: 'open-week', name: 'Open the weekly note of this week', callback: () => void this.openPeriod('week', localIso(new Date()), false) });
		this.addCommand({ id: 'open-month', name: 'Open the monthly note of this month', callback: () => void this.openPeriod('month', localIso(new Date()), false) });
		this.addCommand({ id: 'open-year', name: 'Open the yearly note of this year', callback: () => void this.openPeriod('year', localIso(new Date()), false) });

		this.app.workspace.onLayoutReady(() => {
			// The pane goes into the right sidebar one time, after the first install. A pane that the user closed stays closed.
			if (!this.settings.paneAdded) void this.addPaneOnce();
			void pro.refresh();
			this.registerInterval(window.setInterval(() => void pro.refresh(), PRO_TICK_MS));
		});
	}

	onunload(): void {
		// Obsidian closes the views of this type, and each view removes its own events and timers in onClose.
		resetPro();
	}

	views(): MonthCalendarView[] {
		return this.app.workspace
			.getLeavesOfType(VIEW_TYPE)
			.map((l) => l.view)
			.filter((v): v is MonthCalendarView => v instanceof MonthCalendarView);
	}

	/** Settings or Pro changed: draw each calendar again. reindex also reads the notes again. */
	refreshViews(reindex = false): void {
		for (const v of this.views()) void v.refresh(reindex);
	}

	locale(): string {
		return effectiveLocale(this.settings);
	}

	rule(): WeekRule {
		return weekRule(this.settings, this.locale());
	}

	/** Reads the core Daily notes settings again, or takes the custom fields. */
	async readDaily(): Promise<PeriodConfig> {
		const s = this.settings;
		if (s.dailySource === 'custom') {
			this.daily = { folder: cleanFolder(s.dailyFolder), format: s.dailyFormat, template: s.dailyTemplate };
			return this.daily;
		}
		let raw: unknown = null;
		try {
			const path = normalizePath(`${this.app.vault.configDir}/daily-notes.json`);
			if (await this.app.vault.adapter.exists(path)) raw = JSON.parse(await this.app.vault.adapter.read(path));
		} catch {
			// A broken file gives the core defaults, like core Daily notes does.
			raw = null;
		}
		this.daily = dailyFromCore(raw);
		return this.daily;
	}

	config(period: Period): PeriodConfig {
		const s = this.settings;
		if (period === 'day') return this.daily;
		const k = NAMES[period] as 'weekly' | 'monthly' | 'quarterly' | 'yearly';
		return { folder: s[`${k}Folder`], format: s[`${k}Format`], template: s[`${k}Template`] };
	}

	/** The vault path of the note of a period. */
	pathOf(period: Period, iso: IsoDate): string {
		return periodPath(period, this.config(period), iso, this.rule());
	}

	/** Opens the note of the period, or creates it from its template. A modifier click or a middle click opens a new tab. */
	async openPeriod(period: Period, iso: IsoDate, target: PaneType | boolean, existing?: TFile): Promise<void> {
		if (period === 'day') {
			// The core Daily notes settings can change at any time. A change draws the calendars with the new folder.
			const before = JSON.stringify(this.daily);
			if (JSON.stringify(await this.readDaily()) !== before) this.refreshViews(true);
		}
		// Always the exact note of the period. A note that only starts with the date never takes its place.
		const exact = this.pathOf(period, iso);
		const file = existing?.path === exact ? existing : this.app.vault.getFileByPath(exact);
		if (file) {
			await this.app.workspace.getLeaf(target).openFile(file);
			return;
		}
		const path = exact;
		if (this.settings.confirmCreate) {
			const ok = await new Promise<boolean>((resolve) => new ConfirmModal(this.app, `Create the ${NAMES[period]} note ${path}?`, resolve).open());
			if (!ok) return;
		}
		try {
			const created = await this.createNote(period, iso, path);
			await this.app.workspace.getLeaf(target).openFile(created);
		} catch (err) {
			console.error('month-calendar: create failed', err);
			new Notice(`Month Calendar could not create ${path}.`);
		}
	}

	private async createNote(period: Period, iso: IsoDate, path: string): Promise<TFile> {
		const cfg = this.config(period);
		let text = '';
		const tpl = templatePath(cfg.template);
		const tplFile = tpl ? this.app.vault.getFileByPath(tpl) : null;
		if (tplFile) {
			const name = periodName(period, cfg.format, iso, this.rule());
			const title = name.slice(name.lastIndexOf('/') + 1);
			text = fillTemplate(await this.app.vault.cachedRead(tplFile), title, iso, new Date(), period === 'day' ? cfg.format : 'YYYY-MM-DD');
		} else if (tpl) {
			new Notice(`Month Calendar did not find the template ${tpl}. The new note is empty.`);
		}
		const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
		if (dir && !this.app.vault.getFolderByPath(dir)) await this.app.vault.createFolder(dir);
		return this.app.vault.create(path, text);
	}

	async activateView(): Promise<void> {
		const leaf = await this.ensureLeaf();
		if (!leaf) return;
		await this.app.workspace.revealLeaf(leaf);
		// On a phone the right sidebar is a drawer. Open it when it is still closed.
		const split = this.app.workspace.rightSplit;
		if (leaf.getRoot() === split && split.collapsed) split.expand();
		if (!(leaf.view instanceof MonthCalendarView)) await leaf.setViewState({ type: VIEW_TYPE, active: true });
	}

	private async addPaneOnce(): Promise<void> {
		await this.ensureLeaf();
		this.settings.paneAdded = true;
		await this.saveSettings();
	}

	private async ensureLeaf(): Promise<WorkspaceLeaf | null> {
		const open = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
		if (open) return open;
		const leaf = this.app.workspace.getRightLeaf(false);
		if (!leaf) return null;
		await leaf.setViewState({ type: VIEW_TYPE, active: false });
		return leaf;
	}

	async loadSettings(): Promise<void> {
		this.settings = normalizeSettings((await this.loadData()) as Partial<MonthCalendarSettings> | null);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
