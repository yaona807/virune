import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { compileSource } from '../packages/compiler/dist/src/index.js';

const root = resolve(process.argv[2] ?? '.');
const directory = join(root, 'conformance');
const files = await collectViruneFiles(directory);
for (const [index, file] of files.entries()) {
	const source = { id: index + 1, path: file, text: await readFile(file, 'utf8') };
	const result = compileSource(source, { emit: false });
	const diagnostics = result.diagnostics.map(item => ({
		severity: item.severity,
		code: item.code,
		line: item.span.start.line,
		column: item.span.start.column,
		endLine: item.span.end.line,
		endColumn: item.span.end.column,
	}));
	let rules = [];
	try {
		const previous = JSON.parse(await readFile(`${file}.expected.json`, 'utf8'));
		if (Array.isArray(previous.rules)) rules = previous.rules;
	} catch {}
	const expectation = {
		schemaVersion: 1,
		status: diagnostics.some(item => item.severity === 'error') ? 'compile-error' : 'compile-success',
		diagnostics,
		...(rules.length === 0 ? {} : { rules }),
	};
	await writeFile(`${file}.expected.json`, `${JSON.stringify(expectation, null, 2)}\n`, 'utf8');
	console.log(`Updated ${relative(root, file)}.expected.json`);
}

async function collectViruneFiles(path) {
	const info = await stat(path);
	if (info.isFile()) return path.endsWith('.virune') ? [path] : [];
	const output = [];
	for (const entry of await readdir(path, { withFileTypes: true })) {
		const child = join(path, entry.name);
		if (entry.isDirectory()) output.push(...await collectViruneFiles(child));
		else if (entry.name.endsWith('.virune')) output.push(child);
	}
	return output.sort();
}
