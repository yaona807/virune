import { readFile, readdir } from 'node:fs/promises';
import { resolve, relative } from 'node:path';

const roots = ['packages/compiler/src', 'packages/cli/src'];
const ranges = [
	[0, 999, 'syntax'],
	[1000, 1999, 'binding'],
	[2000, 2999, 'type-system'],
	[3000, 3999, 'control-flow'],
	[4000, 4999, 'module'],
	[5000, 5999, 'entry-point'],
	[9000, 9999, 'internal'],
];

export async function collectDiagnosticCatalog(repositoryRoot = process.cwd()) {
	const occurrences = new Map();
	const invalid = [];
	for (const root of roots) {
		for (const file of await collectTypeScriptFiles(resolve(repositoryRoot, root))) {
			const source = await readFile(file, 'utf8');
			const candidates = [
				...source.matchAll(/\.(?:error|warning|information|hint)\(\s*['"`]([^'"`]+)['"`]/gu),
				...source.matchAll(/\bcode:\s*['"`]([^'"`]+)['"`]/gu),
			];
			for (const match of candidates) {
				const code = match[1];
				if (code === undefined) continue;
				if (!/^L\d{4}$/u.test(code) || categoryFor(code) === undefined) {
					invalid.push({ code, file: relative(repositoryRoot, file).replaceAll('\\', '/') });
					continue;
				}
				const locations = occurrences.get(code) ?? new Set();
				locations.add(relative(repositoryRoot, file).replaceAll('\\', '/'));
				occurrences.set(code, locations);
			}
		}
	}
	if (invalid.length > 0) {
		throw new Error(`Invalid diagnostic codes:\n${invalid.map(item => `- ${item.code} in ${item.file}`).join('\n')}`);
	}
	return [...occurrences.entries()]
		.map(([code, files]) => ({ code, qualifiedCode: `virune/${code}`, category: categoryFor(code), files: [...files].sort() }))
		.sort((left, right) => left.code.localeCompare(right.code));
}

export function categoryFor(code) {
	if (!/^L\d{4}$/u.test(code)) return undefined;
	const value = Number.parseInt(code.slice(1), 10);
	return ranges.find(([first, last]) => value >= first && value <= last)?.[2];
}

function renderMarkdown(catalog) {
	return [
		'# Virune diagnostic code catalog',
		'',
		'| Code | Qualified code | Category | Source locations |',
		'| --- | --- | --- | --- |',
		...catalog.map(item => `| \`${item.code}\` | \`${item.qualifiedCode}\` | ${item.category} | ${item.files.map(file => `\`${file}\``).join('<br>')} |`),
		'',
	].join('\n');
}

async function collectTypeScriptFiles(directory) {
	const output = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const path = resolve(directory, entry.name);
		if (entry.isDirectory()) output.push(...await collectTypeScriptFiles(path));
		else if (entry.isFile() && entry.name.endsWith('.ts')) output.push(path);
	}
	return output;
}

if (resolve(process.argv[1] ?? '') === resolve(new URL(import.meta.url).pathname)) {
	const catalog = await collectDiagnosticCatalog();
	if (process.argv.includes('--json')) console.log(JSON.stringify({ schemaVersion: 1, source: 'virune', diagnostics: catalog }, null, 2));
	else console.log(renderMarkdown(catalog));
}
