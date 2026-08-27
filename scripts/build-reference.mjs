import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import MarkdownIt from 'markdown-it';
import { verifySpec } from './verify-spec.mjs';

const RULE_ID_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+$/u;
const SHA_PATTERN = /^[0-9a-f]{40}$/u;

const markdown = new MarkdownIt('commonmark', {
	html: false,
	xhtmlOut: false,
	breaks: false,
	linkify: false,
	typographer: false,
});
markdown.enable('table');
// Virune owns link validation. Keep markdown-it from silently downgrading an
// unsafe or broken link into plain text before the fail-closed resolver sees it.
markdown.validateLink = () => true;
markdown.normalizeLink = value => value;
markdown.normalizeLinkText = value => value;

export async function buildReference(root = resolve('.'), options = {}) {
	root = resolve(root);
	const outputDirectory = resolveReferenceOutputDirectory(root, options.outputDirectory);
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

export function resolveReferenceOutputDirectory(root, value) {
	const cacheRoot = resolve(root, '.cache/reference');
	const outputDirectory = resolve(value ?? join(cacheRoot, 'site'));
	const fromCache = relative(cacheRoot, outputDirectory);
	if (fromCache === '..' || fromCache.startsWith(`..${sep}`) || isAbsolute(fromCache)) {
		throw new Error(`Reference output must stay under ${cacheRoot}: ${outputDirectory}`);
	}
	return outputDirectory;
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
	const tokens = parseMarkdown(source);
	applyReferenceAnchors(tokens, context.sourcePath);
	rewriteReferenceLinks(tokens, context);
	return markdown.renderer.render(tokens, markdown.options, {});
}

export function collectAnchors(source, sourcePath = '<markdown>') {
	const tokens = parseMarkdown(source);
	const anchors = new Set();
	for (let index = 0; index < tokens.length; index++) {
		const token = tokens[index];
		if (token.type !== 'heading_open' && token.type !== 'paragraph_open') continue;
		const inline = tokens[index + 1];
		if (inline?.type !== 'inline') continue;
		const ruleId = extractRuleId(inline);
		const anchor = ruleId ?? (token.type === 'heading_open' ? slugifyHeading(inline) : null);
		if (anchor === null) continue;
		if (anchors.has(anchor)) {
			const line = token.map?.[0];
			const location = line === undefined ? sourcePath : `${sourcePath}:${line + 1}`;
			throw new Error(`${location}: duplicate anchor ${anchor}`);
		}
		anchors.add(anchor);
	}
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
	const tokens = parseMarkdown(source);
	let title = null;
	for (let index = 0; index < tokens.length; index++) {
		if (tokens[index].type !== 'heading_open' || tokens[index].tag !== 'h1') continue;
		const inline = tokens[index + 1];
		if (inline?.type === 'inline') {
			title = inlinePlainText(inline);
			break;
		}
	}
	if (title === null || title.length === 0) throw new Error(`${sourcePath}: missing H1 title`);
	return { locale, sourcePath, counterpartSourcePath: `spec/${counterpartName}`, outputPath, title };
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

function parseMarkdown(source) {
	return markdown.parse(source.replace(/\r\n?/gu, '\n'), {});
}

function applyReferenceAnchors(tokens, sourcePath) {
	const observed = new Set();
	for (let index = 0; index < tokens.length; index++) {
		const token = tokens[index];
		if (token.type !== 'heading_open' && token.type !== 'paragraph_open') continue;
		const inline = tokens[index + 1];
		if (inline?.type !== 'inline') continue;
		const ruleId = extractRuleId(inline);
		const anchor = ruleId ?? (token.type === 'heading_open' ? slugifyHeading(inline) : null);
		if (anchor === null) continue;
		if (observed.has(anchor)) {
			const line = token.map?.[0];
			const location = line === undefined ? sourcePath : `${sourcePath}:${line + 1}`;
			throw new Error(`${location}: duplicate anchor ${anchor}`);
		}
		observed.add(anchor);
		token.attrSet('id', anchor);
	}
}

function rewriteReferenceLinks(tokens, context) {
	for (const token of tokens) {
		if (token.type === 'link_open') {
			const href = token.attrGet('href');
			if (href === null) throw new Error(`${context.sourcePath}: Markdown link is missing href`);
			token.attrSet('href', context.resolveLink(href));
		} else if (token.type === 'image') {
			const source = token.attrGet('src');
			if (source === null) throw new Error(`${context.sourcePath}: Markdown image is missing src`);
			token.attrSet('src', context.resolveLink(source));
		}
		if (Array.isArray(token.children)) rewriteReferenceLinks(token.children, context);
	}
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
	if (!existsSync(absolute)) throw new Error(`${page.sourcePath}: broken repository link ${target}`);
	if (fragment !== '') throw new Error(`${page.sourcePath}: cannot verify anchor outside Reference sources ${target}`);
	return `${repositoryUrl}/blob/${sourceSha}/${resolvedSource}`;
}

function extractRuleId(inline) {
	const first = inline.children?.[0];
	if (first?.type !== 'code_inline') return null;
	const match = /^\[([^\]\r\n]+)\]$/u.exec(first.content);
	if (match === null) return null;
	if (!RULE_ID_PATTERN.test(match[1])) throw new Error(`Invalid rule ID in Reference source: ${match[1]}`);
	return match[1];
}

function slugifyHeading(inline) {
	const plain = inlinePlainText(inline).normalize('NFKC').toLowerCase();
	const slug = plain.replace(/[^\p{Letter}\p{Number}]+/gu, '-').replace(/^-+|-+$/gu, '');
	if (slug === '') throw new Error(`Unable to derive heading anchor from ${inline.content}`);
	return slug;
}

function inlinePlainText(inline) {
	return plainTextFromTokens(inline.children ?? []);
}

function plainTextFromTokens(tokens) {
	let output = '';
	for (const token of tokens) {
		if (token.type === 'text' || token.type === 'code_inline') output += token.content;
		else if (token.type === 'softbreak' || token.type === 'hardbreak') output += ' ';
		else if (token.type === 'image') output += token.content;
		else if (Array.isArray(token.children)) output += plainTextFromTokens(token.children);
	}
	return output;
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

function escapeHtml(value) {
	return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function escapeAttribute(value) {
	return escapeHtml(value);
}

function referenceStyles() {
	return `:root{font-family:system-ui,sans-serif;line-height:1.55;color:#171717;background:#fff}body{margin:0}header{display:flex;gap:1rem;align-items:center;padding:1rem 1.25rem;border-bottom:1px solid #ddd;flex-wrap:wrap}header span{color:#666}header a{margin-left:auto}.language-switch+ a{margin-left:0}.layout{display:grid;grid-template-columns:minmax(13rem,18rem) minmax(0,1fr);max-width:90rem;margin:auto}nav{padding:1.5rem;border-right:1px solid #ddd}nav ul{list-style:none;padding:0;margin:0}nav li{margin:.35rem 0}nav a[aria-current=page]{font-weight:700}main{padding:2rem;max-width:70rem}pre{overflow:auto;background:#f6f6f6;padding:1rem;border-radius:.35rem}code{font-family:ui-monospace,monospace}table{border-collapse:collapse}th,td{border:1px solid #ccc;padding:.4rem .6rem;text-align:left}a{color:inherit}h1,h2,h3,h4,h5,h6{scroll-margin-top:1rem}@media(max-width:760px){.layout{display:block}nav{border-right:0;border-bottom:1px solid #ddd}header a{margin-left:0}}\n`;
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
