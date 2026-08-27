import { access, readFile, readdir } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const markdownFiles = await collectMarkdown(root);
const errors = [];

for (const file of markdownFiles) {
	const source = await readFile(file, 'utf8');
	await verifyLinks(file, withoutCodeFences(source));
	if (file.endsWith('_ja.md')) {
		const english = file.replace(/_ja\.md$/u, '.md');
		if (!await exists(english)) errors.push(`${relative(root, file)} has no English counterpart`);
	}
	if (!file.endsWith('_ja.md') && linksToJapaneseCounterpart(source)) {
		const japanese = file.replace(/\.md$/u, '_ja.md');
		if (!await exists(japanese)) errors.push(`${relative(root, file)} links to Japanese documentation but ${relative(root, japanese)} is missing`);
	}
}

await verifyRepositoryDocumentationLayout();
await verifyVersionConsistency();

if (errors.length > 0) throw new Error(`Documentation verification failed:\n${errors.map(item => `- ${item}`).join('\n')}`);
console.log(`Verified ${markdownFiles.length} Markdown files, bilingual counterparts, relative links, minimal documentation layout, and release version consistency.`);

export function linksToJapaneseCounterpart(source) {
	return /\[日本語(?:版)?\]\([^)]*_ja\.md/u.test(source);
}

async function collectMarkdown(directory) {
	const output = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'release' || entry.name === '.cache') continue;
		const path = resolve(directory, entry.name);
		if (entry.isDirectory()) output.push(...await collectMarkdown(path));
		else if (entry.isFile() && entry.name.endsWith('.md')) output.push(path);
	}
	return output.sort();
}

async function verifyLinks(file, source) {
	for (const match of source.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/gu)) {
		const raw = match[1].trim().replace(/^<|>$/gu, '');
		const target = raw.split(/\s+["']/u, 1)[0];
		if (target === '' || target.startsWith('#') || /^(?:https?:|mailto:|data:)/u.test(target)) continue;
		const pathPart = decodeURIComponent(target.split('#', 1)[0]);
		const resolved = pathPart.startsWith('/') ? resolve(root, `.${pathPart}`) : resolve(dirname(file), pathPart);
		if (!await exists(resolved)) errors.push(`${relative(root, file)} links to missing ${target}`);
	}
}

async function verifyRepositoryDocumentationLayout() {
	const required = [
		'README.md',
		'README_ja.md',
		'CONTRIBUTING.md',
		'CONTRIBUTING_ja.md',
		'COMPATIBILITY.md',
		'COMPATIBILITY_ja.md',
		'SECURITY.md',
		'SECURITY_ja.md',
		'CODE_OF_CONDUCT.md',
		'CODE_OF_CONDUCT_ja.md',
		'LICENSE',
		'NOTICE',
		'THIRD_PARTY_NOTICES.md',
		'spec/README.md',
		'spec/README_ja.md',
		'spec/runtime-abi.md',
		'spec/runtime-abi_ja.md',
	];
	for (const path of required) {
		if (!await exists(resolve(root, path))) errors.push(`required canonical document is missing: ${path}`);
	}

	for (const path of ['docs', '.github/self-hosting-operations']) {
		if (await exists(resolve(root, path))) errors.push(`redundant documentation location must not exist: ${path}`);
	}
	for (const path of ['GOVERNANCE.md', 'GOVERNANCE_ja.md', 'THIRD_PARTY_NOTICES_ja.md']) {
		if (await exists(resolve(root, path))) errors.push(`redundant root document must not exist: ${path}`);
	}

	const packagesDirectory = resolve(root, 'packages');
	for (const entry of await readdir(packagesDirectory, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		for (const name of ['README.md', 'README_ja.md']) {
			const path = resolve(packagesDirectory, entry.name, name);
			if (await exists(path)) errors.push(`package documentation duplicates repository canonical sources: ${relative(root, path)}`);
		}
	}
}

async function verifyVersionConsistency() {
	const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
	const version = manifest.version;
	const cliSource = await readFile(resolve(root, 'packages/cli/src/main.ts'), 'utf8');
	if (!cliSource.includes(`const VERSION = '${version}';`)) errors.push(`packages/cli/src/main.ts VERSION does not match ${version}`);
	const vscodeManifest = JSON.parse(await readFile(resolve(root, 'packages/vscode/package.json'), 'utf8'));
	if (vscodeManifest.version !== version) errors.push(`VS Code extension version ${vscodeManifest.version} does not match ${version}`);
}

function withoutCodeFences(source) {
	return source.replace(/^```[\s\S]*?^```\s*$/gmu, '');
}

async function exists(path) {
	try { await access(path); return true; } catch { return false; }
}
