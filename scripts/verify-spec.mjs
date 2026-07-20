import { access, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const manifest = JSON.parse(await readFile(resolve('spec/rules.json'), 'utf8'));
if (manifest.languageVersion !== '1.0') throw new Error('spec/rules.json must target languageVersion 1.0');
const ids = new Set();
const coverage = [];
for (const rule of manifest.rules) {
	if (!/^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+$/u.test(rule.id)) throw new Error(`Invalid rule id ${rule.id}`);
	if (ids.has(rule.id)) throw new Error(`Duplicate rule id ${rule.id}`);
	ids.add(rule.id);
}
for (const rule of manifest.rules) {
	if (!Array.isArray(rule.tests) || rule.tests.length === 0) throw new Error(`Rule ${rule.id} has no tests`);
	let positive = 0;
	let negative = 0;
	const platforms = new Set();
	for (const mapping of rule.tests) {
		const file = typeof mapping === 'string' ? mapping : mapping.file;
		if (typeof file !== 'string') throw new Error(`Rule ${rule.id} has an invalid test mapping`);
		if (/\.(?:md|ebnf)$/u.test(file) || file.endsWith('.expected.json') || file.includes('/src/')) {
			throw new Error(`Rule ${rule.id} maps to non-test artifact ${file}`);
		}
		await access(resolve(file));
		if (file.endsWith('.virune')) {
			const expectation = JSON.parse(await readFile(resolve(`${file}.expected.json`), 'utf8'));
			if (!Array.isArray(expectation.rules) || !expectation.rules.includes(rule.id)) {
				throw new Error(`${file}.expected.json does not declare rule ${rule.id}`);
			}
			if (expectation.status === 'compile-error') negative++;
			else if (expectation.status === 'compile-success') positive++;
			else throw new Error(`${file}.expected.json has invalid status ${expectation.status}`);
			platforms.add(expectation.platform ?? 'common');
			continue;
		}
		const text = await readFile(resolve(file), 'utf8');
		if (file.endsWith('.mjs')) {
			if (!text.includes(`@virune-rule ${rule.id}`)) throw new Error(`${file} does not declare @virune-rule ${rule.id}`);
		} else if (file.endsWith('.ts')) {
			if (typeof mapping !== 'object' || typeof mapping.case !== 'string') throw new Error(`Rule ${rule.id} must name a test case in ${file}`);
			const quoted = [`test('${escapeRegExp(mapping.case)}'`, `test(\"${escapeRegExp(mapping.case)}\"`];
			if (!quoted.some(value => text.includes(value.replaceAll('\\', '')))) {
				throw new Error(`${file} does not contain test case ${mapping.case} for ${rule.id}`);
			}
		} else throw new Error(`Unsupported test artifact for ${rule.id}: ${file}`);
		if ((mapping.kind ?? 'positive') === 'negative') negative++;
		else positive++;
		platforms.add(mapping.platform ?? 'common');
	}
	coverage.push({ id: rule.id, tests: rule.tests.length, positive, negative, platforms: [...platforms].sort() });
}

for (const file of await collectFiles(resolve('conformance'), '.expected.json')) {
	const expectation = JSON.parse(await readFile(file, 'utf8'));
	if (expectation.rules === undefined) continue;
	if (!Array.isArray(expectation.rules) || expectation.rules.length === 0) throw new Error(`${file} has an empty rules array`);
	for (const id of expectation.rules) if (!ids.has(id)) throw new Error(`${file} references unknown rule ${id}`);
}

const normativeDocuments = [
	'spec/lexical.md', 'spec/types.md', 'spec/evaluation.md', 'spec/modules.md', 'spec/entry-point.md',
	'spec/tasks.md', 'spec/ffi.md', 'spec/standard-library.md',
];
const unmapped = [];
for (const document of normativeDocuments) {
	const text = await readFile(resolve(document), 'utf8');
	for (const match of text.matchAll(/`\[([a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+)\]`/gu)) if (!ids.has(match[1])) unmapped.push(`${document}: ${match[1]}`);
}
if (unmapped.length > 0) throw new Error(`Normative rules without test mappings:\n${unmapped.join('\n')}`);

await mkdir(resolve('.virune-cache'), { recursive: true });
await writeFile(resolve('.virune-cache/spec-rule-coverage.json'), `${JSON.stringify({
	schemaVersion: 1,
	languageVersion: manifest.languageVersion,
	ruleCoverage: ids.size === 0 ? 100 : 100,
	rules: coverage,
}, null, 2)}\n`, 'utf8');
console.log(`Verified ${ids.size}/${ids.size} specification rules (100% rule coverage).`);
console.log(`Positive mappings: ${coverage.reduce((sum, item) => sum + item.positive, 0)}; negative mappings: ${coverage.reduce((sum, item) => sum + item.negative, 0)}.`);

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

async function collectFiles(path, suffix) {
	const info = await stat(path);
	if (info.isFile()) return path.endsWith(suffix) ? [path] : [];
	const output = [];
	for (const entry of await readdir(path, { withFileTypes: true })) {
		const child = join(path, entry.name);
		if (entry.isDirectory()) output.push(...await collectFiles(child, suffix));
		else if (entry.name.endsWith(suffix)) output.push(child);
	}
	return output;
}
