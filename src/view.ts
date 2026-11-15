import { ItemView, Keymap, TFile, debounce, getAllTags, type HoverParent, type HoverPopover, type WorkspaceLeaf } from 'obsidian';
import { countWords, dotCount, heatLevels, localIso, monthGrid, parseIso, shiftMonth, weekdayOrder, type IsoDate } from './dates';
import { colorForTags, dayFromProperty, dayOfNote, numberFromProperty, parseTagColors, type Period, type TagColor } from './notes';
import { PRO_LEADS, proValue } from './settings';
import { DayIndex } from './day-index';
import { moment } from './obsidian-moment';
import { isPro, proNotice } from './pro';
import type MonthCalendarPlugin from './main';

export const VIEW_TYPE = 'month-calendar';

/** Wait after the last vault or metadata event before the calendar reads the notes again. */
export const UPDATE_DELAY_MS = 300;

interface DayInfo {
	files: TFile[];
	dots: number;
	tasks: boolean;
	color: TagColor | null;
	heat: number | null;
}

export class MonthCalendarView extends ItemView implements HoverParent {
	hoverPopover: HoverPopover | null = null;
	private readonly plugin: MonthCalendarPlugin;
	private year: number;
	private month: number;
	private today: IsoDate;
	/** Notes of each day, from the daily note rules and (Pro) the date property. Null when it must be built again. */
	private index: DayIndex | null = null;
	/** Word counts by path, kept while the file does not change. */
	private readonly words = new Map<string, { mtime: number; words: number }>();
	private drawToken = 0;
	private readonly scheduleRedraw = debounce(() => void this.refresh(false), UPDATE_DELAY_MS, true);
	/** For tests: how often the calendar was drawn. */
	draws = 0;

	constructor(leaf: WorkspaceLeaf, plugin: MonthCalendarPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.today = localIso(new Date());
		const p = parseIso(this.today);
		this.year = p?.y ?? 2026;
		this.month = p?.m ?? 1;
	}

	getViewType(): string {
		return VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'Calendar';
	}

	getIcon(): string {
		return 'calendar-days';
	}

	async onOpen(): Promise<void> {
		this.contentEl.addClass('mc-view');
		const { metadataCache, vault, workspace } = this.app;
		// A change updates the one file in the index, then the month draws again after a short wait.
		this.registerEvent(
			vault.on('create', (f) => {
				this.index?.update(f.path);
				this.scheduleRedraw();
			}),
		);
		this.registerEvent(
			vault.on('delete', (f) => {
				this.index?.remove(f.path);
				this.scheduleRedraw();
			}),
		);
		this.registerEvent(
			vault.on('rename', (f, oldPath) => {
				this.index?.rename(oldPath, f.path);
				this.scheduleRedraw();
			}),
		);
		// An edit changes words, tasks, tags and properties. Only a date property can move a note to another day.
		this.registerEvent(
			metadataCache.on('changed', (f) => {
				if (proValue(this.plugin.settings, 'dateProperty', isPro()).trim()) this.index?.update(f.path);
				this.scheduleRedraw();
			}),
		);
		this.registerEvent(workspace.on('file-open', () => void this.refresh(false)));
		// The day changes at midnight: check each minute.
		this.registerInterval(
			window.setInterval(() => {
				const now = localIso(new Date());
				if (now !== this.today) {
					this.today = now;
					void this.refresh(false);
				}
			}, 60_000),
		);
		await this.refresh(true);
	}

	async onClose(): Promise<void> {
		this.scheduleRedraw.cancel();
		this.drawToken++;
		this.index = null;
		this.words.clear();
		this.contentEl.empty();
		await Promise.resolve();
	}

	/** The month that shows, as year and month 1 to 12. */
	shownMonth(): { y: number; m: number } {
		return { y: this.year, m: this.month };
	}

	showMonth(y: number, m: number): void {
		this.year = y;
		this.month = m;
		void this.refresh(false);
	}

	move(delta: number): void {
		const next = shiftMonth(this.year, this.month, delta);
		this.showMonth(next.y, next.m);
	}

	/** Reads the settings and (with reindex) the notes again, then draws the month. */
	async refresh(reindex: boolean): Promise<void> {
		const token = ++this.drawToken;
		if (reindex || !this.index) {
			await this.plugin.readDaily();
			this.index = this.buildIndex();
		}
		const info = await this.monthInfo();
		if (token !== this.drawToken) return;
		this.draw(info);
	}

	/** One pass over the Markdown files: the day of each daily note and (Pro) of each note with the date property. */
	private buildIndex(): DayIndex {
		const cfg = this.plugin.daily;
		const prefix = this.plugin.settings.matchPrefix;
		const prop = proValue(this.plugin.settings, 'dateProperty', isPro()).trim();
		const index = new DayIndex((path) => {
			const days = [dayOfNote(path, cfg, prefix)];
			if (prop && path.endsWith('.md')) {
				const f = this.app.vault.getFileByPath(path);
				const v = f ? (this.app.metadataCache.getFileCache(f)?.frontmatter?.[prop] as unknown) : undefined;
				days.push(dayFromProperty(v));
			}
			return days;
		});
		index.rebuild(this.app.vault.getMarkdownFiles().map((f) => f.path));
		return index;
	}

	private async wordsOf(f: TFile): Promise<number> {
		const hit = this.words.get(f.path);
		if (hit && hit.mtime === f.stat.mtime) return hit.words;
		const n = countWords(await this.app.vault.cachedRead(f));
		this.words.set(f.path, { mtime: f.stat.mtime, words: n });
		return n;
	}

	private async monthInfo(): Promise<Map<IsoDate, DayInfo>> {
		const out = new Map<IsoDate, DayInfo>();
		const pro = isPro();
		const heatProp = proValue(this.plugin.settings, 'heatProperty', pro).trim();
		const rules = parseTagColors(proValue(this.plugin.settings, 'tagColors', pro));
		const days = monthGrid(this.year, this.month, this.plugin.rule()).flatMap((w) => w.days);
		const heat: (number | null)[] = [];
		for (const iso of days) {
			const files = (this.index?.files(iso) ?? []).map((p) => this.app.vault.getFileByPath(p)).filter((f): f is TFile => f !== null);
			let words = 0;
			let tasks = false;
			let color: TagColor | null = null;
			let value: number | null = null;
			for (const f of files) {
				words += await this.wordsOf(f);
				const cache = this.app.metadataCache.getFileCache(f);
				if (cache?.listItems?.some((li) => li.task === ' ')) tasks = true;
				if (!color && rules.length && cache) color = colorForTags(getAllTags(cache) ?? [], rules);
				if (value === null && heatProp) value = numberFromProperty(cache?.frontmatter?.[heatProp] as unknown);
			}
			heat.push(value);
			out.set(iso, { files, dots: files.length ? dotCount(words) : 0, tasks, color, heat: value });
		}
		const levels = heatLevels(heat);
		days.forEach((iso, i) => {
			const d = out.get(iso);
			if (d) d.heat = levels[i] ?? 0;
		});
		return out;
	}

	private draw(info: Map<IsoDate, DayInfo>): void {
		const el = this.contentEl;
		el.empty();
		this.draws++;
		const settings = this.plugin.settings;
		const locale = this.plugin.locale();
		const rule = this.plugin.rule();
		const pro = isPro();
		const first = `${this.year}-${String(this.month).padStart(2, '0')}-01`;
		const active = this.app.workspace.getActiveFile()?.path ?? null;
		const data = moment.localeData(locale);

		const header = el.createDiv({ cls: 'mc-header' });
		const title = header.createDiv({ cls: 'mc-title' });
		this.periodButton(title, 'month', first, data.months(moment(first, 'YYYY-MM-DD', true)), 'mc-month', `Open the monthly note of ${first.slice(0, 7)}`);
		this.periodButton(title, 'year', first, String(this.year), 'mc-year', `Open the yearly note of ${this.year}`);
		const nav = header.createDiv({ cls: 'mc-nav' });
		this.navButton(nav, '‹', 'Previous month', () => this.move(-1));
		this.navButton(nav, 'Today', 'Show this month', () => {
			const p = parseIso(this.today);
			if (p) this.showMonth(p.y, p.m);
		});
		this.navButton(nav, '›', 'Next month', () => this.move(1));

		const weeks = settings.showWeekNumbers;
		const grid = el.createDiv({ cls: `mc-grid ${weeks ? 'has-weeks' : ''}`, attr: { role: 'grid', 'aria-label': `${data.months(moment(first, 'YYYY-MM-DD', true))} ${this.year}` } });
		const head = grid.createDiv({ cls: 'mc-row mc-head', attr: { role: 'row' } });
		if (weeks) head.createDiv({ cls: 'mc-weekday mc-wk-head', text: 'W', attr: { role: 'columnheader', 'aria-label': 'Week' } });
		const short = data.weekdaysMin();
		const long = data.weekdays();
		for (const wd of weekdayOrder(rule.weekStart)) head.createDiv({ cls: 'mc-weekday', text: short[wd] ?? '', attr: { role: 'columnheader', 'aria-label': long[wd] ?? '' } });

		for (const row of monthGrid(this.year, this.month, rule)) {
			const r = grid.createDiv({ cls: 'mc-row', attr: { role: 'row' } });
			if (weeks) {
				const path = this.plugin.pathOf('week', row.days[0] as IsoDate);
				const file = this.app.vault.getFileByPath(path);
				const cell = this.cell(r, 'mc-week', `Week ${row.week}, open or create the weekly note`);
				cell.setAttr('data-week', String(row.week));
				cell.createDiv({ cls: 'mc-num', text: String(row.week) });
				this.dots(cell, file ? 1 : 0, false, null);
				if (file?.path === active) cell.addClass('is-active');
				this.bind(cell, 'week', row.days[0] as IsoDate, file ?? undefined);
			}
			for (const iso of row.days) {
				const d = info.get(iso);
				const p = parseIso(iso);
				const cell = this.cell(r, 'mc-day', moment(iso, 'YYYY-MM-DD', true).locale(locale).format('LL'));
				cell.setAttr('data-date', iso);
				cell.createDiv({ cls: 'mc-num', text: String(p?.d ?? '') });
				if (p?.m !== this.month) cell.addClass('is-other-month');
				if (iso === this.today) {
					cell.addClass('is-today');
					cell.setAttr('aria-current', 'date');
				}
				const files = d?.files ?? [];
				if (files.length) cell.addClass('has-note');
				if (active && files.some((f) => f.path === active)) cell.addClass('is-active');
				if (d?.heat) cell.addClass(`mc-heat-${d.heat}`);
				this.dots(cell, d?.dots ?? 0, d?.tasks ?? false, d?.color ?? null);
				// A click opens or creates the exact daily note. A prefix note only adds dots.
				this.bind(cell, 'day', iso, this.app.vault.getFileByPath(this.plugin.pathOf('day', iso)) ?? undefined);
			}
		}

		if (proValue(settings, 'showQuarterRow', pro)) {
			const strip = el.createDiv({ cls: 'mc-periods', attr: { role: 'group', 'aria-label': 'Quarters and year' } });
			for (let q = 1; q <= 4; q++) {
				const iso = `${this.year}-${String((q - 1) * 3 + 1).padStart(2, '0')}-01`;
				this.periodCell(strip, 'quarter', iso, `Q${q}`, `Quarter ${q} of ${this.year}`);
			}
			this.periodCell(strip, 'year', first, String(this.year), `Year ${this.year}`);
		}
	}

	private navButton(parent: HTMLElement, text: string, label: string, onClick: () => void): void {
		const b = parent.createEl('button', { cls: 'mc-nav-button', text, attr: { 'aria-label': label } });
		b.addEventListener('click', onClick);
	}

	private periodButton(parent: HTMLElement, period: Period, iso: IsoDate, text: string, cls: string, label: string): void {
		const file = this.app.vault.getFileByPath(this.plugin.pathOf(period, iso));
		const b = parent.createEl('button', { cls: `mc-period-title ${cls}`, text, attr: { 'aria-label': label } });
		if (file) b.addClass('has-note');
		this.bind(b, period, iso, file ?? undefined);
	}

	private periodCell(parent: HTMLElement, period: Period, iso: IsoDate, text: string, label: string): void {
		const file = this.app.vault.getFileByPath(this.plugin.pathOf(period, iso));
		const cell = this.cell(parent, `mc-period mc-${period}`, `${label}, open or create the note`);
		cell.createDiv({ cls: 'mc-num', text });
		this.dots(cell, file ? 1 : 0, false, null);
		this.bind(cell, period, iso, file ?? undefined);
	}

	private cell(parent: HTMLElement, cls: string, label: string): HTMLElement {
		return parent.createDiv({ cls: `mc-cell ${cls}`, attr: { role: 'gridcell', tabindex: '0', 'aria-label': label } });
	}

	private dots(cell: HTMLElement, count: number, tasks: boolean, color: TagColor | null): void {
		const box = cell.createDiv({ cls: 'mc-dots', attr: { 'aria-hidden': 'true' } });
		for (let i = 0; i < count; i++) {
			const dot = box.createSpan({ cls: 'mc-dot' });
			if (color) dot.addClass(`mc-dot-${color}`);
		}
		if (tasks) box.createSpan({ cls: 'mc-dot mc-dot-task' });
	}

	/** Click, Enter and middle click open the note; a modifier opens a new tab. Hover shows the page preview. */
	private bind(el: HTMLElement, period: Period, iso: IsoDate, file?: TFile): void {
		const open = (evt: MouseEvent | KeyboardEvent, target?: 'tab') => {
			if ((period === 'quarter' || period === 'year') && el.hasClass('mc-period') && !isPro()) {
				proNotice(PRO_LEADS.quarterCell);
				return;
			}
			void this.plugin.openPeriod(period, iso, target ?? Keymap.isModEvent(evt), file);
		};
		el.addEventListener('click', (evt) => open(evt));
		el.addEventListener('auxclick', (evt) => {
			if (evt.button === 1) open(evt, 'tab');
		});
		el.addEventListener('keydown', (evt) => {
			if (evt.key !== 'Enter' && evt.key !== ' ') return;
			evt.preventDefault();
			open(evt);
		});
		if (file) {
			el.addEventListener('mouseover', (event) => {
				this.app.workspace.trigger('hover-link', { event, source: VIEW_TYPE, hoverParent: this, targetEl: el, linktext: file.path, sourcePath: '' });
			});
		}
	}
}
