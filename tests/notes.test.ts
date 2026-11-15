import { describe, expect, it } from 'vitest';
import { ISO_RULE } from '../src/dates';
import {
	DEFAULT_FORMATS,
	cleanFolder,
	colorForTags,
	dailyFromCore,
	dayFromProperty,
	dayOfNote,
	fillTemplate,
	numberFromProperty,
	parseTagColors,
	periodName,
	periodPath,
	templatePath,
	withWeekTokens,
} from '../src/notes';

const US = { weekStart: 0, minDays: 1 };

describe('core Daily notes settings', () => {
	it('reads folder, format and template from daily-notes.json', () => {
		expect(dailyFromCore({ folder: '/Journal/Daily/', format: 'YYYY/MM/YYYY-MM-DD', template: 'Templates/Day' })).toEqual({
			folder: 'Journal/Daily',
			format: 'YYYY/MM/YYYY-MM-DD',
			template: 'Templates/Day',
		});
	});

	it('gives the core defaults for a missing or broken file', () => {
		expect(dailyFromCore(null)).toEqual({ folder: '', format: 'YYYY-MM-DD', template: '' });
		expect(dailyFromCore({ folder: 5, format: '  ' })).toEqual({ folder: '', format: 'YYYY-MM-DD', template: '' });
		expect(cleanFolder('/')).toBe('');
	});
});

describe('note paths', () => {
	it('puts a daily note in the root or in a folder', () => {
		expect(periodPath('day', dailyFromCore({}), '2026-11-10', ISO_RULE)).toBe('2026-11-10.md');
		expect(periodPath('day', { folder: 'Daily/', format: 'YYYY-MM-DD', template: '' }, '2026-11-10', ISO_RULE)).toBe('Daily/2026-11-10.md');
	});

	it('takes a custom format with subfolders and names', () => {
		const cfg = { folder: 'Journal', format: 'YYYY/MM-MMMM/YYYY-MM-DD dddd', template: '' };
		expect(periodPath('day', cfg, '2026-11-10', ISO_RULE, 'en')).toBe('Journal/2026/11-November/2026-11-10 Tuesday.md');
	});

	it('names week notes from the calendar rule, not from the moment locale', () => {
		// 2026-01-01 is a Thursday: ISO week 1 starts on 2025-12-29, the US week 1 on 2025-12-28.
		expect(periodName('week', DEFAULT_FORMATS.week, '2026-01-01', ISO_RULE)).toBe('2026-W01');
		expect(periodName('week', DEFAULT_FORMATS.week, '2027-01-02', ISO_RULE)).toBe('2026-W53');
		expect(periodName('week', 'GGGG-[W]WW', '2025-12-28', US)).toBe('2026-W01');
		expect(periodName('week', '[Week] w [of] gg', '2026-11-10', US)).toBe('Week 46 of 26');
	});

	it('keeps text in brackets when it puts the week tokens in', () => {
		expect(withWeekTokens('gggg-[week ww]-ww', 7, 2026)).toBe('[2026]-[week ww]-[07]');
	});

	it('names month, quarter and year notes from any day of the period', () => {
		expect(periodPath('month', { folder: 'Months', format: 'YYYY-MM', template: '' }, '2026-11-30', ISO_RULE)).toBe('Months/2026-11.md');
		expect(periodName('quarter', DEFAULT_FORMATS.quarter, '2026-11-10', ISO_RULE)).toBe('2026-Q4');
		expect(periodName('quarter', DEFAULT_FORMATS.quarter, '2026-03-31', ISO_RULE)).toBe('2026-Q1');
		expect(periodName('year', DEFAULT_FORMATS.year, '2026-12-31', ISO_RULE)).toBe('2026');
	});

	it('adds .md to a template without an extension', () => {
		expect(templatePath('Templates/Day')).toBe('Templates/Day.md');
		expect(templatePath('/Templates/Day.md')).toBe('Templates/Day.md');
		expect(templatePath(' ')).toBe('');
	});
});

describe('the day of a note', () => {
	const core = { folder: 'Daily', format: 'YYYY-MM-DD', template: '' };

	it('matches the exact name in the folder', () => {
		expect(dayOfNote('Daily/2026-11-10.md', core, false)).toBe('2026-11-10');
		expect(dayOfNote('2026-11-10.md', core, false)).toBeNull();
		expect(dayOfNote('Daily/2026-02-30.md', core, false)).toBeNull();
		expect(dayOfNote('Daily/2026-11-10.canvas', core, false)).toBeNull();
	});

	it('finds daily notes in subfolders of the folder', () => {
		expect(dayOfNote('Daily/2026/11/2026-11-10.md', core, false)).toBe('2026-11-10');
	});

	it('matches a format with subfolders by its path', () => {
		const cfg = { folder: 'Journal', format: 'YYYY/MM/YYYY-MM-DD', template: '' };
		expect(dayOfNote('Journal/2026/11/2026-11-10.md', cfg, false)).toBe('2026-11-10');
		expect(dayOfNote('Journal/Old/2026-11-10.md', cfg, false)).toBe('2026-11-10');
	});

	it('matches a date at the start of the name only when the setting is on', () => {
		const compact = { folder: '', format: 'YYYYMMDD', template: '' };
		expect(dayOfNote('20241105 Title.md', compact, true)).toBe('2024-11-05');
		expect(dayOfNote('20241105 Title.md', compact, false)).toBeNull();
		expect(dayOfNote('Daily/2026-11-10 Standup notes.md', core, true)).toBe('2026-11-10');
		expect(dayOfNote('Daily/2026-11-10_retro.md', core, true)).toBe('2026-11-10');
		expect(dayOfNote('Daily/Meeting 2026-11-10.md', core, true)).toBeNull();
	});
});

describe('templates', () => {
	it('fills title, date and time like core Daily notes', () => {
		const now = new Date(2026, 10, 10, 9, 5);
		const out = fillTemplate('# {{title}}\n{{date}} {{time}}\n{{date:dddd}} {{ date : YYYY }} {{time:HH}}', '2026-11-10', '2026-11-10', now, 'YYYY-MM-DD');
		expect(out).toBe('# 2026-11-10\n2026-11-10 09:05\nTuesday 2026 09');
	});
});

describe('Pro values', () => {
	it('reads a day from a date property', () => {
		expect(dayFromProperty('2026-11-10')).toBe('2026-11-10');
		expect(dayFromProperty('2026-11-10T08:00')).toBe('2026-11-10');
		expect(dayFromProperty(['2026-11-10'])).toBe('2026-11-10');
		expect(dayFromProperty('2026-02-30')).toBeNull();
		expect(dayFromProperty(20261110)).toBeNull();
	});

	it('reads a number from a heat property', () => {
		expect(numberFromProperty(7)).toBe(7);
		expect(numberFromProperty('7.5 h')).toBe(7.5);
		expect(numberFromProperty(true)).toBe(1);
		expect(numberFromProperty('good')).toBeNull();
		expect(numberFromProperty(null)).toBeNull();
	});

	it('reads tag colour rules and picks the first match', () => {
		const rules = parseTagColors('#work blue\nhealth = green\n#bad magenta\n\n#Travel: orange');
		expect(rules).toEqual([
			{ tag: 'work', color: 'blue' },
			{ tag: 'health', color: 'green' },
			{ tag: 'travel', color: 'orange' },
		]);
		expect(colorForTags(['#work/meeting'], rules)).toBe('blue');
		expect(colorForTags(['#travel', '#health'], rules)).toBe('green');
		expect(colorForTags(['#workshop'], rules)).toBeNull();
	});
});
