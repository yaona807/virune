import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, posix, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifySpec } from './verify-spec.mjs';

const RULE_ID_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+$/u;
const RULE_TOKEN_PATTERN = /^`\[([^\]\r\n]+)\]`(?:\s|$)/u;
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const FENCE_PATTERN = /^```([A-Za-z0-9_-]*)\s*$/u;
const TABLE_SEPARATOR_PATTERN = /^\|(?:\s*:?-{3,}:?\s*\|)+\s*$/u;

export async function buildReference(root = resolve('.'), options = {}) {
	root = resolve(root);
	const outputDirectory = resolve(options.outputDirectory ?? join(root, '.cache/reference/site'));
	const sourceSha = options.sourceSha ?? resolveGitSha(root);
	if (!SHA_PATTERN.test(sourceSha)) throw new Error(`Reference source SHA must be a full commit SHA: ${sourceSha}`);

	const packageManifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
	const report = await verifySpec(root, { writeReport: false });
	const identity = resolveReferenceIdentity({
		mode: options.mode ?? 'preview',
		packageVersion: packageManifest.version,
		languageVersion: report.languageVersion,
		releaseTag: options.releaseTag ?? null,
		sourceSha,
	});
	const repositoryUrl = normalizeRepositoryUrl(packageManifest.repository?.url);
	const pages = await discoverPages(root);
	const pageBySource = new Map(pages.filter(page => page.sourcePath !== 'spec/grammar.ebnf').map(page => [`${page.locale}:${page.sourcePath}`, page]));
	const grammarByLocale = new Map(pages.filter(page => page.sourcePath === 'spec/grammar.ebnf').map(page => [page.locale, page]));

	for (const page of pages) {
		if (page.sourcePath === 'spec/grammar.ebnf') {
			page.anchors = new Set(['grammar.complete']);
			continue;
		}
		page.source = await readFile(join(root, ...page.sourcePath.split('/')), 'utf8');
		page.anchors = collectAnchors(page.source, page.sourcePath);
	}
	verifyRuleAnchors(report, pageBySource, grammarByLocale);

	await rm(outputDirectory, { recursive: true, force: true });
	await mkdir(join(outputDirectory, 'assets'), { recursive: true });
	await mkdir(join(outputDirectory, 'ja'), { recursive: true });
	await writeFile(join(outputDirectory, 'assets/reference.css'), referenceStyles(), 'utf8');

	for (const page of pages) {
		const outputPath = join(outputDirectory, ...page.outputPath.split('/'));
		await mkdir(dirname(outputPath), { recursive: true });
		const content = page.sourcePath === 'spec/grammar.ebnf'
			? renderGrammar(await readFile(join(root, 'spec/grammar.ebnf'), 'utf8'), page.title)
			: renderMarkdown(page.source, {
				sourcePath: page.sourcePath,
				outputPath: page.outputPath,
				anchors: page.anchors,
				resolveLink: target => resolveReferenceLink({
					root,
					page,
					target,
					pageBySource,
					grammarByLocale,
					repositoryUrl,
					sourceSha,
				}),
			});
		const counterpart = pages.find(candidate => candidate.sourcePath === page.counterpartSourcePath && candidate.locale !== page.locale)
			?? (page.sourcePath === 'spec/grammar.ebnf' ? grammarByLocale.get(page.locale === 'en' ? 'ja' : 'en') : null);
		const html = renderPage({ page, pages, content, counterpart, identity, repositoryUrl });
		await writeFile(outputPath, html, 'utf8');
	}

	const manifest = {
		schemaVersion: 1,
		mode: identity.mode,
		version: identity.version,
		languageVersion: identity.languageVersion,
		releaseTag: identity.releaseTag,
		sourceSha: identity.sourceSha,
		pages: pages.map(page => ({ locale: page.locale, source: page.sourcePath, output: page.outputPath, title: page.title })),
	};
	await writeFile(join(outputDirectory, 'reference-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
	const outputHash = await hashDirectory(outputDirectory);
	return { ...identity, outputDirectory, outputHash, pageCount: pages.length };
}

export function resolveReferenceIdentity({ mode, packageVersion, languageVersion, releaseTag, sourceSha }) {
	if (mode !== 'preview' && mode !== 'stable') throw new Error(`Unknown Reference mode: ${mode}`);
	if (typeof packageVersion !== 'string' || packageVersion.length === 0) throw new Error('package.json version is missing');
	if (!SHA_PATTERN.test(sourceSha)) throw new Error(`Reference source SHA must be a full commit SHA: ${sourceSha}`);
	if (mode === 'stable') {
		if (packageVersion.includes('-')) throw new Error(`Stable Reference cannot be generated from prerelease version ${packageVersion}`);
		const expectedTag = `v${packageVersion}`;
		if (releaseTag !== expectedTag) throw new Error(`Stable Reference tag mismatch: expected ${expectedTag}, got ${String(releaseTag)}`);
	} else if (releaseTag !== null && releaseTag !== undefined) {
		throw new Error('Preview Reference must not claim a release tag');
	}
	return {
		mode,
		version: packageVersion,
		languageVersion,
		releaseTag: mode === 'stable' ? releaseTag : null,
		sourceSha,
	};
}

export function renderMarkdown(source, context) {
	const lines = source.replace(/\r\n?/gu, '\n').split('\n');
	const output = [];
	let index = 0;
	while (index < lines.length) {
		const line = lines[index];
		if (line.trim() === '') { index++; continue; }

		const fence = FENCE_PATTERN.exec(line);
		if (fence !== null) {
			const body = [];
			index++;
			while (index < lines.length && lines[index] !== '```') body.push(lines[index++]);
			if (index >= lines.length) throw new Error(`${context.sourcePath}: unclosed fenced code block`);
			index++;
			const language = fence[1] === '' ? '' : ` class="language-${escapeAttribute(fence[1])}"`;
			output.push(`<pre><code${language}>${escapeHtml(body.join('\n'))}</code></pre>`);
			continue;
		}

		const heading = /^(#{1,6})\s+(.+?)\s*$/u.exec(line);
		if (heading !== null) {
			const level = heading[1].length;
			const ruleId = extractRuleToken(heading[2]);
			const anchor = ruleId ?? slugifyHeading(heading[2]);
			output.push(`<h${level} id="${escapeAttribute(anchor)}">${renderInline(heading[2], context)}</h${level}>`);
			index++;
			continue;
		}

		if (line.startsWith('|') && index + 1 < lines.length && TABLE_SEPARATOR_PATTERN.test(lines[index + 1])) {
			const header = parseTableRow(line, context.sourcePath);
			index += 2;
			const rows = [];
			while (index < lines.length && lines[index].startsWith('|') && lines[index].trim() !== '') {
				const row = parseTableRow(lines[index], context.sourcePath);
				if (row.length !== header.length) throw new Error(`${context.sourcePath}: table row width differs from header`);
				rows.push(row);
				index++;
			}
			output.push(`<table><thead><tr>${header.map(cell => `<th>${renderInline(cell, context)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${renderInline(cell, context)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
			continue;
		}

		const unordered = /^-\s+(.+)$/u.exec(line);
		if (unordered !== null) {
			const items = [];
			while (index < lines.length) {
				const item = /^-\s+(.+)$/u.exec(lines[index]);
				if (item === null) break;
				items.push(item[1]); index++;
			}
			output.push(`<ul>${items.map(item => `<li>${renderInline(item, context)}</li>`).join('')}</ul>`);
			continue;
		}

		const ordered = /^\d+\.\s+(.+)$/u.exec(line);
		if (ordered !== null) {
			const items = [];
			while (index < lines.length) {
				const item = /^\d+\.\s+(.+)$/u.exec(lines[index]);
				if (item === null) break;
				items.push(item[1]); index++;
			}
			output.push(`<ol>${items.map(item => `<li>${renderInline(item, context)}</li>`).join('')}</ol>`);
			continue;
		}

		if (/^\s/u.test(line)) throw new Error(`${context.sourcePath}:${index + 1}: unsupported indented Markdown block`);
		if (/^(?:>|---$|\*\*\*$)/u.test(line)) throw new Error(`${context.sourcePath}:${index + 1}: unsupported Markdown block syntax`);

		const paragraph = [];
		while (index < lines.length && lines[index].trim() !== '' && !startsBlock(lines, index)) paragraph.push(lines[index++]);
		if (paragraph.length === 0) throw new Error(`${context.sourcePath}:${index + 1}: unable to render Markdown`);
		const text = paragraph.join(' ');
		const ruleId = extractRuleToken(text);
		const id = ruleId === null ? '' : ` id="${escapeAttribute(ruleId)}"`;
		output.push(`<p${id}>${renderInline(text, context)}</p>`);
	}
	return output.join('\n');
}

export function collectAnchors(source, sourcePath = '<markdown>') {
	const anchors = new Set();
	const lines = source.replace(/\r\n?/gu, '\n').split('\n');
	let fenced = false;
	for (const [index, line] of lines.entries()) {
		if (FENCE_PATTERN.test(line)) { fenced = !fenced; continue; }
		if (fenced) continue;
		const heading = /^(#{1,6})\s+(.+?)\s*$/u.exec(line);
		const ruleId = heading === null ? extractRuleToken(line) : extractRuleToken(heading[2]);
		const anchor = ruleId ?? (heading === null ? null : slugifyHeading(heading[2]));
		if (anchor === null) continue;
		if (anchors.has(anchor)) throw new Error(`${sourcePath}:${index + 1}: duplicate anchor ${anchor}`);
		anchors.add(anchor);
	}
	if (fenced) throw new Error(`${sourcePath}: unclosed fenced code block`);
	return anchors;
}

export async function hashDirectory(directory) {
	const files = await collectFiles(directory);
	const hash = createHash('sha256');
	for (const file of files) {
		const path = relative(directory, file).replaceAll('\\', '/');
		hash.update(path); hash.update('\0');
		hash.update(await readFile(file)); hash.update('\0');
	}
	return hash.digest('hex');
}

async function discoverPages(root) {
	const specDirectory = join(root, 'spec');
	const entries = (await readdir(specDirectory, { withFileTypes: true }))
		.filter(entry => entry.isFile()).map(entry => entry.name).sort();
	const englishNames = entries.filter(name => name.endsWith('.md') && name !== 'README.md' && !name.endsWith('_ja.md'));
	const pages = [];
	const indexPairs = [['README.md', 'README_ja.md', 'index.html']];
	for (const [englishName, japaneseName, outputName] of indexPairs) {
		pages.push(await makeMarkdownPage(root, englishName, 'en', outputName, japaneseName));
		pages.push(await makeMarkdownPage(root, japaneseName, 'ja', `ja/${outputName}`, englishName));
	}
	for (const englishName of englishNames) {
		const japaneseName = `${englishName.slice(0, -3)}_ja.md`;
		if (!entries.includes(japaneseName)) throw new Error(`Missing Japanese Reference source spec/${japaneseName}`);
		const stem = englishName.slice(0, -3);
		pages.push(await makeMarkdownPage(root, englishName, 'en', `${stem}.html`, japaneseName));
		pages.push(await makeMarkdownPage(root, japaneseName, 'ja', `ja/${stem}.html`, englishName));
	}
	if (!entries.includes('grammar.ebnf')) throw new Error('Missing Reference source spec/grammar.ebnf');
	pages.push({ locale: 'en', sourcePath: 'spec/grammar.ebnf', counterpartSourcePath: 'spec/grammar.ebnf', outputPath: 'grammar.html', title: 'Normative Grammar' });
	pages.push({ locale: 'ja', sourcePath: 'spec/grammar.ebnf', counterpartSourcePath: 'spec/grammar.ebnf', outputPath: 'ja/grammar.html', title: '規範文法' });
	return pages;
}

async function makeMarkdownPage(root, name, locale, outputPath, counterpartName) {
	const sourcePath = `spec/${name}`;
	const source = await readFile(join(root, 'spec', name), 'utf8');
	const titleMatch = /^#\s+(.+?)\s*$/mu.exec(source);
	if (titleMatch === null) throw new Error(`${sourcePath}: missing H1 title`);
	return { locale, sourcePath, counterpartSourcePath: `spec/${counterpartName}`, outputPath, title: stripInlineMarkup(titleMatch[1]) };
}

function verifyRuleAnchors(report, pageBySource, grammarByLocale) {
	for (const rule of report.rules) {
		if (rule.source === 'spec/grammar.ebnf') {
			for (const locale of ['en', 'ja']) if (!grammarByLocale.get(locale)?.anchors.has(rule.id)) throw new Error(`Missing ${locale} Reference anchor for ${rule.id}`);
			continue;
		}
		if (typeof rule.source !== 'string' || !rule.source.startsWith('spec/') || !rule.source.endsWith('.md')) throw new Error(`Unknown normative Reference source for ${rule.id}: ${String(rule.source)}`);
		const englishPage = pageBySource.get(`en:${rule.source}`);
		const japaneseSource = rule.source.replace(/\.md$/u, '_ja.md');
		const japanesePage = pageBySource.get(`ja:${japaneseSource}`);
		if (englishPage === undefined || japanesePage === undefined) throw new Error(`Missing bilingual Reference page for ${rule.id}`);
		if (!englishPage.anchors.has(rule.id) || !japanesePage.anchors.has(rule.id)) throw new Error(`Missing bilingual Reference anchor for ${rule.id}`);
	}
}

export function renderGrammar(source, title) {
	return `<h1 id="grammar.complete">${escapeHtml(title)}</h1>\n<pre><code>${escapeHtml(source.replace(/\r\n?/gu, '\n'))}</code></pre>`;
}

function renderPage({ page, pages, content, counterpart, identity, repositoryUrl }) {
	const localePages = pages.filter(candidate => candidate.locale === page.locale);
	const nav = localePages.map(candidate => {
		const href = relativeOutputLink(page.outputPath, candidate.outputPath);
		const current = candidate.outputPath === page.outputPath ? ' aria-current="page"' : '';
		return `<li><a href="${escapeAttribute(href)}"${current}>${escapeHtml(candidate.title)}</a></li>`;
	}).join('');
	const sourceUrl = `${repositoryUrl}/blob/${identity.sourceSha}/${page.sourcePath}`;
	const counterpartLink = counterpart === undefined || counterpart === null ? '' : `<a class="language-switch" href="${escapeAttribute(relativeOutputLink(page.outputPath, counterpart.outputPath))}">${page.locale === 'en' ? '日本語' : 'English'}</a>`;
	const identityLabel = identity.mode === 'stable' ? `${identity.releaseTag} · ${identity.sourceSha.slice(0, 12)}` : `Preview · ${identity.sourceSha.slice(0, 12)}`;
	const language = page.locale === 'ja' ? 'ja' : 'en';
	return `<!doctype html>\n<html lang="${language}">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>${escapeHtml(page.title)} · Virune Reference</title>\n<link rel="stylesheet" href="${escapeAttribute(relativeOutputLink(page.outputPath, 'assets/reference.css'))}">\n</head>\n<body>\n<header><strong>Virune Language Reference</strong><span>${escapeHtml(identityLabel)}</span>${counterpartLink}<a href="${escapeAttribute(sourceUrl)}">Source</a></header>\n<div class="layout"><nav aria-label="Reference navigation"><ul>${nav}</ul></nav><main>${content}</main></div>\n</body>\n</html>\n`;
}

function renderInline(text, context) {
	let output = '';
	let rest = text;
	while (rest.length > 0) {
		const code = /^`([^`]+)`/u.exec(rest);
		if (code !== null) { output += `<code>${escapeHtml(code[1])}</code>`; rest = rest.slice(code[0].length); continue; }
		const link = /^\[([^\]]+)\]\(([^)]+)\)/u.exec(rest);
		if (link !== null) {
			const href = context.resolveLink(link[2].trim());
			output += `<a href="${escapeAttribute(href)}">${renderInlineLabel(link[1])}</a>`;
			rest = rest.slice(link[0].length); continue;
		}
		const strong = /^\*\*([^*]+)\*\*/u.exec(rest);
		if (strong !== null) { output += `<strong>${escapeHtml(strong[1])}</strong>`; rest = rest.slice(strong[0].length); continue; }
		const emphasis = /^\*([^*]+)\*/u.exec(rest);
		if (emphasis !== null) { output += `<em>${escapeHtml(emphasis[1])}</em>`; rest = rest.slice(emphasis[0].length); continue; }
		output += escapeHtml(rest[0]); rest = rest.slice(1);
	}
	return output;
}

function renderInlineLabel(text) {
	return text.replace(/`([^`]+)`/gu, (_, value) => `<code>${escapeHtml(value)}</code>`).split(/(<code>.*?<\/code>)/gu).map(part => part.startsWith('<code>') ? part : escapeHtml(part)).join('');
}

function resolveReferenceLink({ root, page, target, pageBySource, grammarByLocale, repositoryUrl, sourceSha }) {
	if (/^(?:https?:|mailto:)/u.test(target)) return target;
	if (/^[a-z][a-z0-9+.-]*:/iu.test(target)) throw new Error(`${page.sourcePath}: unsafe or unsupported link scheme ${target}`);
	const [rawPath, fragment = ''] = target.split('#', 2);
	if (rawPath === '') {
		if (fragment === '' || !page.anchors.has(fragment)) throw new Error(`${page.sourcePath}: broken local anchor ${target}`);
		return `#${fragment}`;
	}
	const decoded = decodeURIComponent(rawPath);
	const sourceDirectory = posix.dirname(page.sourcePath);
	const resolvedSource = posix.normalize(posix.join(sourceDirectory, decoded));
	if (resolvedSource.startsWith('../') || resolvedSource === '..') throw new Error(`${page.sourcePath}: link escapes repository ${target}`);

	let targetPage;
	if (resolvedSource === 'spec/grammar.ebnf') targetPage = grammarByLocale.get(page.locale);
	else if (resolvedSource.startsWith('spec/') && resolvedSource.endsWith('.md')) {
		const locale = resolvedSource.endsWith('_ja.md') ? 'ja' : 'en';
		targetPage = pageBySource.get(`${locale}:${resolvedSource}`);
	}
	if (targetPage !== undefined) {
		if (fragment !== '' && !targetPage.anchors.has(fragment)) throw new Error(`${page.sourcePath}: broken Reference anchor ${target}`);
		return `${relativeOutputLink(page.outputPath, targetPage.outputPath)}${fragment === '' ? '' : `#${fragment}`}`;
	}
	if (resolvedSource.startsWith('spec/')) throw new Error(`${page.sourcePath}: unknown Reference source ${target}`);
	const absolute = join(root, ...resolvedSource.split('/'));
	if (!existsSyncSafe(absolute)) throw new Error(`${page.sourcePath}: broken repository link ${target}`);
	if (fragment !== '') throw new Error(`${page.sourcePath}: cannot verify anchor outside Reference sources ${target}`);
	return `${repositoryUrl}/blob/${sourceSha}/${resolvedSource}`;
}

function startsBlock(lines, index) {
	const line = lines[index];
	if (FENCE_PATTERN.test(line) || /^(#{1,6})\s+/u.test(line) || /^-\s+/u.test(line) || /^\d+\.\s+/u.test(line)) return true;
	return line.startsWith('|') && index + 1 < lines.length && TABLE_SEPARATOR_PATTERN.test(lines[index + 1]);
}

function parseTableRow(line, sourcePath) {
	if (!line.startsWith('|') || !line.trimEnd().endsWith('|')) throw new Error(`${sourcePath}: malformed Markdown table row`);
	return line.trim().slice(1, -1).split('|').map(cell => cell.trim());
}

function extractRuleToken(text) {
	const match = RULE_TOKEN_PATTERN.exec(text);
	if (match === null) return null;
	if (!RULE_ID_PATTERN.test(match[1])) throw new Error(`Invalid rule ID in Reference source: ${match[1]}`);
	return match[1];
}

function slugifyHeading(text) {
	const plain = stripInlineMarkup(text).normalize('NFKC').toLowerCase();
	const slug = plain.replace(/[^\p{Letter}\p{Number}]+/gu, '-').replace(/^-+|-+$/gu, '');
	if (slug === '') throw new Error(`Unable to derive heading anchor from ${text}`);
	return slug;
}

function stripInlineMarkup(text) {
	return text.replace(/`([^`]+)`/gu, '$1').replace(/\[([^\]]+)\]\([^)]+\)/gu, '$1').replace(/\*\*([^*]+)\*\*/gu, '$1').replace(/\*([^*]+)\*/gu, '$1');
}

function relativeOutputLink(from, to) {
	const value = posix.relative(posix.dirname(from), to);
	return value === '' ? posix.basename(to) : value;
}

function normalizeRepositoryUrl(value) {
	if (typeof value !== 'string' || value.length === 0) throw new Error('package.json repository URL is missing');
	const normalized = value.replace(/^git\+/u, '').replace(/\.git$/u, '');
	if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(normalized)) throw new Error(`Unsupported repository URL ${value}`);
	return normalized;
}

function resolveGitSha(root) {
	return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
}

async function collectFiles(directory) {
	const output = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) output.push(...await collectFiles(path));
		else if (entry.isFile()) output.push(path);
	}
	return output.sort();
}

function existsSyncSafe(path) {
	return existsSync(path);
}

function escapeHtml(value) {
	return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function escapeAttribute(value) {
	return escapeHtml(value);
}

function referenceStyles() {
	return `:root{font-family:system-ui,sans-serif;line-height:1.55;color:#171717;background:#fff}body{margin:0}header{display:flex;gap:1rem;align-items:center;padding:1rem 1.25rem;border-bottom:1px solid #ddd;flex-wrap:wrap}header span{color:#666}header a{margin-left:auto}.language-switch+ a{margin-left:0}.layout{display:grid;grid-template-columns:minmax(13rem,18rem) minmax(0,1fr);max-width:90rem;margin:auto}nav{padding:1.5rem;border-right:1px solid #ddd}nav ul{list-style:none;padding:0;margin:0}nav li{margin:.35rem 0}nav a[aria-current=page]{font-weight:700}main{padding:2rem;max-width:70rem}pre{overflow:auto;background:#f6f6f6;padding:1rem;border-radius:.35rem}code{font-family:ui-monospace,monospace}table{border-collapse:collapse}th,td{border:1px solid #ccc;padding:.4rem .6rem;text-align:left}a{color:inherit}h1,h2,h3,h4,h5,h6{scroll-margin-top:1rem}@media(max-width:760px){.layout{display:block}nav{border-right:0;border-bottom:1px solid #ddd}header a{margin-left:0}.language-switch+ a{margin-left:0}}\n`;
}

function parseArguments(values) {
	const options = { mode: 'preview', check: false };
	for (const value of values) {
		if (value === '--check') options.check = true;
		else if (value.startsWith('--output=')) options.outputDirectory = value.slice('--output='.length);
		else if (value.startsWith('--mode=')) options.mode = value.slice('--mode='.length);
		else if (value.startsWith('--release-tag=')) options.releaseTag = value.slice('--release-tag='.length);
		else if (value.startsWith('--source-sha=')) options.sourceSha = value.slice('--source-sha='.length);
		else throw new Error(`Unknown argument ${value}`);
	}
	return options;
}

async function main() {
	const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
	const options = parseArguments(process.argv.slice(2));
	if (!options.check) {
		const result = await buildReference(root, options);
		console.log(`Built ${result.pageCount} Reference pages with SHA-256 ${result.outputHash}.`);
		return;
	}
	const checkRoot = join(root, '.cache/reference/determinism');
	const first = join(checkRoot, 'first');
	const second = join(checkRoot, 'second');
	try {
		const sourceSha = options.sourceSha ?? resolveGitSha(root);
		const shared = { ...options, check: undefined, sourceSha };
		const left = await buildReference(root, { ...shared, outputDirectory: first });
		const right = await buildReference(root, { ...shared, outputDirectory: second });
		if (left.outputHash !== right.outputHash) throw new Error(`Reference output is not deterministic: ${left.outputHash} != ${right.outputHash}`);
		console.log(`Verified deterministic Reference output ${left.outputHash} from ${sourceSha}.`);
	} finally {
		await rm(checkRoot, { recursive: true, force: true });
	}
}

const entry = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (entry === fileURLToPath(import.meta.url)) await main();
