// Note paths for each period, the core Daily notes settings and the match of a file name to a day.
// moment comes from Obsidian (the same instance that core Daily notes uses). Week tokens use the rule of the
// calendar, not the global moment locale, so a week row and its note always agree.
import { normalizePath } from 'obsidian';
import { moment } from './obsidian-moment';
import { parseIso, startOfWeek, quarterOf, weekOfYear, type IsoDate, type WeekRule } from './dates';

export type Period = 'day' | 'week' | 'month' | 'quarter' | 'year';

export interface PeriodConfig {
	/** Folder of the notes, '' for the vault root. */
	folder: string;
	/** moment format of the note name. It can hold "/" for subfolders, for example YYYY/MM/YYYY-MM-DD. */
	format: string;
	/** Path of a template note, '' for none. */
	template: string;
}

export const DEFAULT_FORMATS: Record<Period, string> = {
	day: 'YYYY-MM-DD',
	week: 'gggg-[W]ww',
	month: 'YYYY-MM',
	quarter: 'YYYY-[Q]Q',
	year: 'YYYY',
};

/** Reads the saved core Daily notes options (.obsidian/daily-notes.json). Bad or missing values get the core defaults. */
export function dailyFromCore(raw: unknown): PeriodConfig {
	const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
	const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
	return { folder: cleanFolder(str(o.folder)), format: str(o.format) || DEFAULT_FORMATS.day, template: str(o.template) };
}

/** A folder without "/" at the start or the end. '' and "/" are the vault root. */
export function cleanFolder(folder: string): string {
	const f = folder.trim().replace(/^\/+|\/+$/g, '');
	return f ? normalizePath(f) : '';
}

/**
 * Puts the week number and week year of the calendar rule into a moment format as literal text.
 * gggg, GGGG are the week year, gg, GG its last two digits, ww, WW the padded week, w, W the week.
 * Text in [brackets] stays as it is.
 */
export function withWeekTokens(format: string, week: number, weekYear: number): string {
	const parts = format.split(/(\[[^\]]*\])/);
	return parts
		.map((part) => {
			if (part.startsWith('[')) return part;
			return part.replace(/gggg|GGGG|gg|GG|ww|WW|wo|Wo|w|W/g, (tok) => {
				if (tok === 'gggg' || tok === 'GGGG') return `[${String(weekYear).padStart(4, '0')}]`;
				if (tok === 'gg' || tok === 'GG') return `[${String(weekYear % 100).padStart(2, '0')}]`;
				if (tok === 'ww' || tok === 'WW') return `[${String(week).padStart(2, '0')}]`;
				if (tok === 'wo' || tok === 'Wo') return `[${moment.localeData().ordinal(week)}]`;
				return `[${week}]`;
			});
		})
		.join('');
}

/** The first day of the period that holds iso. A week starts on the rule's week start. */
export function periodStart(period: Period, iso: IsoDate, rule: WeekRule): IsoDate {
	const p = parseIso(iso);
	if (!p) throw new Error(`Not a date: ${iso}`);
	const mm = (n: number) => String(n).padStart(2, '0');
	if (period === 'day') return iso;
	if (period === 'week') return startOfWeek(iso, rule.weekStart);
	if (period === 'month') return `${p.y}-${mm(p.m)}-01`;
	if (period === 'quarter') return `${p.y}-${mm((quarterOf(p.m) - 1) * 3 + 1)}-01`;
	return `${p.y}-01-01`;
}

/** The note name (without .md, can hold "/") of the period that holds iso. */
export function periodName(period: Period, format: string, iso: IsoDate, rule: WeekRule, locale?: string): string {
	const start = periodStart(period, iso, rule);
	let fmt = format || DEFAULT_FORMATS[period];
	if (period === 'week') {
		const wk = weekOfYear(start, rule);
		fmt = withWeekTokens(fmt, wk.week, wk.year);
	}
	const m = moment(start, 'YYYY-MM-DD', true);
	if (locale) m.locale(locale);
	return m.format(fmt);
}

/** The vault path of the note of the period that holds iso. */
export function periodPath(period: Period, cfg: PeriodConfig, iso: IsoDate, rule: WeekRule, locale?: string): string {
	const name = periodName(period, cfg.format, iso, rule, locale);
	const folder = cleanFolder(cfg.folder);
	return normalizePath(folder ? `${folder}/${name}.md` : `${name}.md`);
}

/** Places in a name where a date prefix can end: the end of the name, or before a space, "_", "-", "." or ",". */
function prefixCuts(name: string): number[] {
	const cuts: number[] = [];
	for (let i = name.length - 1; i >= 4; i--) if (/[\s_.,-]/.test(name[i] ?? '')) cuts.push(i);
	return cuts;
}

function strictDay(text: string, format: string): IsoDate | null {
	const m = moment(text, format, true);
	return m.isValid() ? m.format('YYYY-MM-DD') : null;
}

/**
 * The day of a daily note, or null. path is the vault path. The note must be in the folder or a subfolder of it.
 * With the vault root as the folder, the note must be at the folder depth of the format.
 * Rules in order: the path under the folder matches the format, the file name matches the format, and (with prefix)
 * the file name starts with a date in the format, for example "20241105 Title" for YYYYMMDD.
 */
export function dayOfNote(path: string, cfg: PeriodConfig, prefix: boolean): IsoDate | null {
	if (!path.toLowerCase().endsWith('.md') || !/\d/.test(path)) return null;
	const folder = cleanFolder(cfg.folder);
	if (folder && !path.startsWith(`${folder}/`)) return null;
	const rel = (folder ? path.slice(folder.length + 1) : path).slice(0, -3);
	const format = cfg.format || DEFAULT_FORMATS.day;
	// Fast path for the vault root: a note at another folder depth than the format can not be in place.
	if (!folder && rel.split('/').length !== format.split('/').length) return null;
	const base = rel.slice(rel.lastIndexOf('/') + 1);
	const dir = rel.slice(0, Math.max(0, rel.lastIndexOf('/')));
	const byPath = strictDay(rel, format);
	if (byPath) return byPath;
	const cut = format.lastIndexOf('/');
	const nameFormat = format.slice(cut + 1);
	// The vault root has no daily folder. There a note must sit in the folders that the format makes for its day,
	// so a dated note in any other folder of the vault never counts.
	const inPlace = (day: IsoDate) => folder !== '' || dir === (cut < 0 ? '' : moment(day, 'YYYY-MM-DD', true).format(format.slice(0, cut)));
	const byName = strictDay(base, nameFormat);
	if (byName) return inPlace(byName) ? byName : null;
	if (!prefix) return null;
	for (const c of prefixCuts(base)) {
		const hit = strictDay(base.slice(0, c), nameFormat);
		if (hit) return inPlace(hit) ? hit : null;
	}
	return null;
}

/**
 * Fills a template like core Daily notes and Templates do: {{title}}, {{date}}, {{time}}, {{date:FORMAT}} and
 * {{time:FORMAT}}. date is the day of the note; now gives the time.
 */
export function fillTemplate(text: string, title: string, iso: IsoDate, now: Date, dateFormat: string): string {
	const day = moment(iso, 'YYYY-MM-DD', true);
	const time = moment(now);
	return text.replace(/{{\s*(title|date|time)\s*(?::([^}]*?))?\s*}}/gi, (_all, key: string, fmt: string | undefined) => {
		const k = key.toLowerCase();
		if (k === 'title') return title;
		if (k === 'date') return day.format(fmt?.trim() || dateFormat || 'YYYY-MM-DD');
		return time.format(fmt?.trim() || 'HH:mm');
	});
}

/** A template path from settings gets ".md" when it has no extension. */
export function templatePath(template: string): string {
	const t = template.trim().replace(/^\/+/, '');
	if (!t) return '';
	return normalizePath(/\.[a-z0-9]+$/i.test(t) ? t : `${t}.md`);
}

/** Pro: the day in a frontmatter value, or null. It takes "YYYY-MM-DD" with an optional time after it. */
export function dayFromProperty(value: unknown): IsoDate | null {
	const v: unknown = Array.isArray(value) ? (value as unknown[])[0] : value;
	if (typeof v !== 'string') return null;
	const m = /^\s*(\d{4}-\d{2}-\d{2})(?:[T\s].*)?$/.exec(v);
	return m && parseIso(m[1] as string) ? (m[1] as string) : null;
}

/** Pro: a number in a frontmatter value, or null. "7", 7 and "7.5 h" give a number; text without a number gives null. */
export function numberFromProperty(value: unknown): number | null {
	const v: unknown = Array.isArray(value) ? (value as unknown[])[0] : value;
	if (typeof v === 'number' && Number.isFinite(v)) return v;
	if (typeof v === 'boolean') return v ? 1 : 0;
	if (typeof v !== 'string') return null;
	const m = /^\s*(-?\d+(?:\.\d+)?)/.exec(v);
	return m ? Number(m[1]) : null;
}

export const TAG_COLORS = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink'] as const;
export type TagColor = (typeof TAG_COLORS)[number];

/**
 * Pro: "tag colour" lines, for example "#work blue". Tags compare without "#" and without case; a rule for "work"
 * also takes "work/meeting". Lines with an unknown colour are skipped.
 */
export function parseTagColors(text: string): { tag: string; color: TagColor }[] {
	const out: { tag: string; color: TagColor }[] = [];
	for (const line of text.split('\n')) {
		const m = /^\s*#?([^\s#=:]+)\s*[=:]?\s*([a-z]+)\s*$/i.exec(line);
		if (!m) continue;
		const color = (m[2] as string).toLowerCase() as TagColor;
		if (TAG_COLORS.includes(color)) out.push({ tag: (m[1] as string).toLowerCase(), color });
	}
	return out;
}

/** Pro: the colour of the first rule that matches one of the tags, or null. */
export function colorForTags(tags: string[], rules: { tag: string; color: TagColor }[]): TagColor | null {
	const clean = tags.map((t) => t.replace(/^#/, '').toLowerCase());
	for (const r of rules) if (clean.some((t) => t === r.tag || t.startsWith(`${r.tag}/`))) return r.color;
	return null;
}
