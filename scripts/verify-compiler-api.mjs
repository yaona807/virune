import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const snapshot = JSON.parse(await readFile(resolve('packages/compiler/api/stable-api.snapshot.json'), 'utf8'));
const source = await readFile(resolve('packages/compiler/src/public-api.ts'), 'utf8');
const index = (await readFile(resolve('packages/compiler/src/index.ts'), 'utf8')).trim();
const packageJson = JSON.parse(await readFile(resolve('packages/compiler/package.json'), 'utf8'));
const experimental = await readFile(resolve('packages/compiler/src/experimental-api.ts'), 'utf8');

if (index !== "export * from './public-api.js';") throw new Error('Compiler root entry point must export only public-api.ts');
const exportKeys = Object.keys(packageJson.exports ?? {}).sort();
if (JSON.stringify(exportKeys) !== JSON.stringify(['.', './experimental'])) {
	throw new Error(`Compiler package exports changed: ${exportKeys.join(', ')}`);
}
for (const forbidden of ['./mir/', './hir/lower.js', './reference/']) {
	if (experimental.includes(forbidden)) throw new Error(`Experimental API exposes internal module ${forbidden}`);
}

const values = new Set();
const types = new Set();
for (const match of source.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gu)) values.add(match[1]);
for (const match of source.matchAll(/export\s+(?:interface|type)\s+([A-Za-z_$][\w$]*)/gu)) types.add(match[1]);
for (const match of source.matchAll(/export\s*\{([^}]+)\}\s*;/gu)) {
	for (const item of match[1].split(',')) values.add(item.trim().split(/\s+as\s+/u).at(-1));
}
for (const match of source.matchAll(/export\s+type\s*\{([^}]+)\}/gu)) {
	for (const item of match[1].split(',')) types.add(item.trim().split(/\s+as\s+/u).at(-1));
}
const actual = { values: [...values].filter(Boolean).sort(), types: [...types].filter(Boolean).sort() };
for (const kind of ['values', 'types']) {
	const expected = [...snapshot[kind]].sort();
	if (JSON.stringify(actual[kind]) !== JSON.stringify(expected)) {
		throw new Error(`Stable compiler ${kind} changed.\nExpected: ${expected.join(', ')}\nActual:   ${actual[kind].join(', ')}`);
	}
}
console.log(`Verified stable compiler API: ${actual.values.length} values, ${actual.types.length} types.`);
