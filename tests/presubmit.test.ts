// s1115a A1. Obsidian community directory presubmit: the manifest, README, LICENSE and source rules that the
// directory review checks (obsidianmd/obsidian-releases validate-plugin-entry.yml at c884be96, Submission
// requirements, Plugin guidelines, Developer policies, eslint-plugin-obsidianmd 0.6.0). The same file is in
// each new plugin. Each rule also runs on a planted fault, so a rule that stops catching its fault fails here.
// The id and name collision check needs community-plugins.json from the network; the sprint lane runs it.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..');
const REQUIRED = ['id', 'name', 'description', 'author', 'version', 'minAppVersion', 'isDesktopOnly'];
const ALLOWED = [...REQUIRED, 'authorUrl', 'fundingUrl', 'helpUrl'];

type Manifest = Record<string, unknown>;
type Source = { path: string; text: string };

/** Problems of a manifest. folder is the product folder name, which is also the repo name. */
export function manifestProblems(m: Manifest, folder: string): string[] {
	const p: string[] = [];
	const str = (k: string) => (typeof m[k] === 'string' ? (m[k] as string) : '');
	for (const k of REQUIRED) if (!(k in m)) p.push(`missing ${k}`);
	for (const k of Object.keys(m)) if (!ALLOWED.includes(k)) p.push(`key ${k} is not allowed`);
	for (const k of REQUIRED) if (k in m && typeof m[k] !== (k === 'isDesktopOnly' ? 'boolean' : 'string')) p.push(`${k} has the wrong type`);
	const id = str('id');
	const name = str('name');
	const desc = str('description');
	if (!/^[a-z0-9_-]+$/.test(id)) p.push('id has characters outside a-z 0-9 - _');
	if (id.toLowerCase().includes('obsidian')) p.push('id has obsidian');
	if (id.toLowerCase().endsWith('plugin')) p.push('id ends with plugin');
	if (id !== folder) p.push(`id ${id} is not the folder name ${folder}`);
	if (name === '' || name !== name.trim() || /[\x00-\x1f:]/.test(name)) p.push('name is empty, has edge spaces, a colon or a control character');
	if (name.toLowerCase().includes('obsidian')) p.push('name has obsidian');
	if (name.toLowerCase().endsWith('plugin')) p.push('name ends with plugin');
	if (name.toLowerCase().startsWith('obsi') || name.toLowerCase().endsWith('dian')) p.push('name has part of obsidian');
	if (/^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$/.test(str('author'))) p.push('author is an email address');
	if (desc.toLowerCase().includes('obsidian')) p.push('description has obsidian');
	if (/this (is a )?plugin/i.test(desc)) p.push('description says this plugin');
	if (!desc.endsWith('.')) p.push('description does not end with a period');
	if (desc.length === 0 || desc.length > 250) p.push('description is empty or longer than 250 characters');
	if (desc !== desc.trim() || !/^[\x20-\x7e]*$/.test(desc) || !/^[A-Z]/.test(desc)) p.push('description has edge spaces, special characters or no capital first letter');
	if (!/^\d+\.\d+\.\d+$/.test(str('version'))) p.push('version is not x.y.z');
	if (!/^\d+\.\d+\.\d+$/.test(str('minAppVersion'))) p.push('minAppVersion is not x.y.z');
	const authorUrl = str('authorUrl');
	if (authorUrl === 'https://obsidian.md' || authorUrl.toLowerCase().includes(`github.com/theluckystrike/${folder}`)) p.push('authorUrl points to obsidian.md or to the plugin repo');
	if ('fundingUrl' in m && (str('fundingUrl') === '' || str('fundingUrl') === 'https://obsidian.md/pricing' || !str('fundingUrl').startsWith('https://'))) p.push('fundingUrl is empty, obsidian.md/pricing or not https');
	return p;
}

/** Removes // and block comments, keeps strings and line breaks. */
export function stripComments(src: string): string {
	let out = '';
	for (let i = 0; i < src.length; ) {
		const c = src[i]!;
		if (c === "'" || c === '"' || c === '`') {
			let j = i + 1;
			while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
			out += src.slice(i, j + 1);
			i = j + 1;
		} else if (src.startsWith('//', i)) {
			const j = src.indexOf('\n', i);
			i = j < 0 ? src.length : j;
		} else if (src.startsWith('/*', i)) {
			const e = src.indexOf('*/', i + 2);
			const j = e < 0 ? src.length : e + 2;
			out += src.slice(i, j).replace(/[^\n]/g, '');
			i = j;
		} else {
			out += c;
			i++;
		}
	}
	return out;
}

// scope 'settings': the rule applies only to a file that defines a settings tab (the guideline and the
// obsidianmd/settings-tab rules cover settings tabs only; a heading in a view such as the vendored hello page is allowed).
const SOURCE_RULES: { rule: string; re: RegExp; scope?: 'settings' }[] = [
	{ rule: 'innerHTML, outerHTML or insertAdjacentHTML', re: /\.(innerHTML|outerHTML)\b|insertAdjacentHTML/ },
	{ rule: 'default hotkey on a command', re: /\bhotkeys\s*:/ },
	{ rule: 'global app', re: /\bwindow\.app\b/ },
	{ rule: 'console method other than warn, error, debug', re: /\bconsole\.(?!(?:warn|error|debug)\b)\w+\s*\(/ },
	{ rule: 'hardcoded style in JS', re: /\.style\.(?!setProperty\(\s*['"]--)[a-zA-Z]+\s*=(?!=)|\.style\.cssText|setAttribute\(\s*['"]style/ },
	{ rule: 'workspace.activeLeaf', re: /\.activeLeaf\b/ },
	{ rule: 'var declaration', re: /(?<![\w.$])var\s+[A-Za-z_$]/ },
	{ rule: 'HTML heading element in a settings tab (use setHeading)', re: /createEl\(\s*['"]h[1-6]['"]/, scope: 'settings' },
	{ rule: 'getFiles().find by path', re: /getFiles\(\)\s*\.\s*find\(/ },
	{ rule: 'regex lookbehind (iOS before 16.4)', re: /\(\?<[!=]/ },
	{ rule: 'global document (use activeDocument or el.doc)', re: /(?<![\w.$])document\.(body|activeElement|querySelector\w*|createElement|addEventListener)\b|registerDomEvent\(\s*document\b|\(\s*document\s*[,)]/ },
	{ rule: 'eval or new Function', re: /(?<![\w.$])eval\s*\(|new\s+Function\s*\(/ },
	{ rule: 'sample code name', re: /\b(MyPlugin|MyPluginSettings|SampleSettingTab|SampleModal|SampleView)\b/ },
	{ rule: 'Node.js or Electron import on a mobile plugin', re: /(?:from\s+|require\(\s*|import\(\s*)['"](?:fs|path|os|crypto|child_process|electron|http|https|net|zlib|stream|worker_threads|node:[a-z_/]+)['"]/ },
];

/** Problems of the plugin source files, as "rule at path:line". */
export function sourceProblems(files: Source[], pluginId: string): string[] {
	const p: string[] = [];
	const at = (f: Source, text: string, index: number) => `${f.path}:${text.slice(0, index).split('\n').length}`;
	for (const f of files) {
		const text = stripComments(f.text);
		const settingsTab = /\bextends\s+PluginSettingTab\b/.test(text);
		for (const { rule, re, scope } of SOURCE_RULES) {
			if (scope === 'settings' && !settingsTab) continue;
			const m = new RegExp(re.source, 'g').exec(text);
			if (m) p.push(`${rule} at ${at(f, text, m.index)}`);
		}
		const cmd = new RegExp(`\\bid\\s*:\\s*['"]${pluginId.replace(/[-]/g, '\\-')}[:-]`).exec(text);
		if (cmd) p.push(`command id repeats the plugin id at ${at(f, text, cmd.index)}`);
		const unload = /\bonunload\s*\([^)]*\)\s*(?::\s*\w+\s*)?\{/.exec(text);
		if (unload) {
			let depth = 1;
			let j = unload.index + unload[0].length;
			for (; j < text.length && depth > 0; j++) depth += text[j] === '{' ? 1 : text[j] === '}' ? -1 : 0;
			if (/detachLeavesOfType|\.detach\(\)/.test(text.slice(unload.index, j))) p.push(`leaves detached in onunload at ${at(f, text, unload.index)}`);
		}
	}
	return p;
}

/** Problems of README.md and LICENSE. pro is true when the plugin has paid features. */
export function repoFileProblems(readme: string, license: string, pro: boolean): string[] {
	const p: string[] = [];
	if (readme.length < 500 || !/^#+ .*(usage|quick start)/im.test(readme)) p.push('README has no usage section');
	if (!license.startsWith('MIT License') || !license.includes('Permission is hereby granted, free of charge') || !license.includes('THE SOFTWARE IS PROVIDED "AS IS"')) p.push('LICENSE is not the MIT text');
	if (pro && !(/^## .*payment/im.test(readme) && /account/i.test(readme) && /network/i.test(readme))) p.push('README does not disclose payment, account and network use');
	return p;
}

function walk(dir: string): string[] {
	return readdirSync(dir).flatMap((n) => {
		const p = join(dir, n);
		return statSync(p).isDirectory() ? walk(p) : /\.(ts|js)$/.test(n) && !/\.(test|spec)\./.test(n) ? [p] : [];
	});
}

const folder = ROOT.replace(/[\\/]+$/, '').split(/[\\/]/).pop()!;
const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8')) as Manifest;
const sources: Source[] = walk(join(ROOT, 'src')).map((p) => ({ path: relative(ROOT, p), text: readFileSync(p, 'utf8') }));
const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
const license = existsSync(join(ROOT, 'LICENSE')) ? readFileSync(join(ROOT, 'LICENSE'), 'utf8') : '';

describe('directory presubmit of this plugin', () => {
	it('has a manifest that passes the directory rules', () => {
		expect(manifestProblems(manifest, folder)).toEqual([]);
	});

	it('maps its version to its minAppVersion in versions.json', () => {
		const versions = JSON.parse(readFileSync(join(ROOT, 'versions.json'), 'utf8')) as Record<string, string>;
		expect(versions[manifest.version as string]).toBe(manifest.minAppVersion);
	});

	it('has a build script the directory scanner runs', () => {
		const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
		expect(['build', 'build:plugin', 'compile'].some((k) => pkg.scripts?.[k])).toBe(true);
	});

	it('has source code free of the patterns the guidelines and the scanner reject', () => {
		expect(sources.length).toBeGreaterThan(0);
		expect(sourceProblems(sources, manifest.id as string)).toEqual([]);
	});

	it('has a README with usage and disclosures, and an MIT LICENSE', () => {
		expect(repoFileProblems(readme, license, typeof manifest.fundingUrl === 'string')).toEqual([]);
	});
});

describe('directory presubmit catches planted faults', () => {
	const m = (patch: Manifest) => manifestProblems({ ...manifest, ...patch }, folder);
	const src = (text: string) => sourceProblems([{ path: 'src/x.ts', text }], manifest.id as string);

	it.each([
		['bad id characters', { id: 'Month_Calendar!' }, 'id has characters'],
		['id with obsidian', { id: 'obsidian-x' }, 'id has obsidian'],
		['id ending with plugin', { id: 'x-plugin' }, 'id ends with plugin'],
		['colon in the name', { name: 'Tools: X' }, 'colon'],
		['trailing space in the name', { name: 'X ' }, 'edge spaces'],
		['name ending with Plugin', { name: 'X Plugin' }, 'name ends with plugin'],
		['description with Obsidian', { description: 'Adds a calendar to Obsidian.' }, 'description has obsidian'],
		['description without a final period', { description: 'Adds a calendar' }, 'period'],
		['description with a trailing space', { description: 'Adds a calendar. ' }, 'period'],
		['description with an emoji', { description: 'Adds a calendar \u{1F4C5}.' }, 'special characters'],
		['description of 251 characters', { description: 'A'.repeat(250) + '.' }, 'longer than 250'],
		['description with this plugin', { description: 'This plugin adds a calendar.' }, 'this plugin'],
		['author email', { author: 'me@example.com' }, 'email'],
		['version with a v prefix', { version: 'v1.0.0' }, 'version is not'],
		['empty fundingUrl', { fundingUrl: '' }, 'fundingUrl'],
		['authorUrl to the plugin repo', { authorUrl: `https://github.com/theluckystrike/${folder}` }, 'authorUrl'],
		['isDesktopOnly as a string', { isDesktopOnly: 'false' }, 'isDesktopOnly has the wrong type'],
		['unknown manifest key', { donate: 'https://x.y' }, 'key donate'],
	])('manifest fault: %s', (_label, patch, want) => {
		expect(m(patch).join('\n')).toContain(want);
	});

	it('manifest fault: missing minAppVersion', () => {
		const { minAppVersion: _drop, ...rest } = manifest;
		expect(manifestProblems(rest, folder)).toContain('missing minAppVersion');
	});

	it.each([
		['innerHTML', 'el.innerHTML = name;', 'innerHTML'],
		['insertAdjacentHTML', 'el.insertAdjacentHTML("beforeend", s);', 'innerHTML'],
		['default hotkey', "this.addCommand({ id: 'go', name: 'Go', hotkeys: [{ modifiers: ['Mod'], key: 'g' }], callback });", 'default hotkey'],
		['console.log', 'console.log("x");', 'console method'],
		['inline style', 'el.style.color = "red";', 'hardcoded style'],
		['activeLeaf', 'const l = this.app.workspace.activeLeaf;', 'activeLeaf'],
		['var', 'var x = 1;', 'var declaration'],
		['h2 in settings', "class S extends PluginSettingTab {\n\tdisplay(): void {\n\t\tcontainerEl.createEl('h2', { text: 'General' });\n\t}\n}", 'HTML heading element in a settings tab'],
		['lookbehind regex', "const re = /(?<!!)\\[x\\]/g;", 'lookbehind'],
		['global document listener', "this.registerDomEvent(document, 'keydown', f);", 'global document'],
		['document.body', 'if (t === document.body) return;', 'global document'],
		['new Function', 'const f = new Function("return 1");', 'eval or new Function'],
		['sample class name', 'export default class MyPlugin extends Plugin {}', 'sample code'],
		['node import', "import { readFileSync } from 'fs';", 'Node.js'],
		['detach in onunload', 'onunload(): void {\n\tif (x) { y(); }\n\tthis.app.workspace.detachLeavesOfType(VIEW);\n}', 'detached in onunload'],
		['command id with the plugin id', `this.addCommand({ id: '${manifest.id as string}-open', name: 'Open', callback });`, 'repeats the plugin id'],
		['CRLF source with innerHTML on line 3', 'a();\r\nb();\r\nel.innerHTML = s;\r\n', 'x.ts:3'],
	])('source fault: %s', (_label, text, want) => {
		expect(src(text).join('\n')).toContain(want);
	});

	it('allows a heading element outside a settings tab (the vendored hello page)', () => {
		expect(src("page.createEl('h1', { text: 'Thanks for updating' });")).toEqual([]);
	});

	it('ignores the patterns inside comments and allows warn, error and debug', () => {
		expect(src('// el.innerHTML = s;\n/* console.log(1); var x; */\nconsole.warn("a"); console.error("b"); console.debug("c");\nconst s = "a // b";')).toEqual([]);
	});

	it('catches a README without disclosures and a LICENSE that is not MIT', () => {
		expect(repoFileProblems('# X\n\n## Usage\n\n' + 'Text. '.repeat(100), 'Copyright me', true)).toEqual(['LICENSE is not the MIT text', 'README does not disclose payment, account and network use']);
	});
});
