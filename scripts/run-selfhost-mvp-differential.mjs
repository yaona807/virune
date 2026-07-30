import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateKernelInput } from '../packages/compiler/dist/src/selfhost/contract.js';
import { writeDifferentialArtifacts } from '../packages/compiler/dist/src/selfhost/differential-artifacts.js';
import { runDifferentialCorpus } from '../packages/compiler/dist/src/selfhost/differential-harness.js';
import { createSelfhostMvpKernel, legacyMvpKernel } from '../packages/compiler/dist/src/selfhost/mvp-adapter.js';
import { executeKernelOutputWithNode } from '../packages/compiler/dist/src/selfhost/node-executor.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const corpusPath = resolve(root, '.github/self-hosting/differential-corpus-v1.json');
const modulePath = resolve(root, 'selfhost/mvp/dist/main.js');
const options = parseArguments(process.argv.slice(2));
const corpus = validateCorpus(JSON.parse(await readFile(corpusPath, 'utf8')));
const fixtures = corpus.fixtures.filter(fixture => fixture.tags.includes('mvp') && (options.fixture === null || fixture.id === options.fixture));
if (fixtures.length === 0) throw new Error(`No MVP differential fixtures matched ${options.fixture ?? 'tag mvp'}`);

const module = await import(`${pathToFileURL(modulePath).href}?run=${Date.now()}`);
const selfhost = createSelfhostMvpKernel(module);
const report = await runDifferentialCorpus({
	fixtures,
	left: { ...legacyMvpKernel, execute: executeKernelOutputWithNode },
	right: { ...selfhost, execute: executeKernelOutputWithNode },
});
const artifacts = await writeDifferentialArtifacts(report, resolve(root, options.output));
console.log(`Self-host MVP differential: ${report.passed ? 'PASS' : 'FAIL'}`);
console.log(`Fixtures: ${report.totals.fixtures}; matched: ${report.totals.matched}; failed: ${report.totals.failed}`);
console.log(`JSON: ${artifacts.jsonPath}`);
console.log(`Summary: ${artifacts.summaryPath}`);
if (!report.passed) process.exitCode = 1;

function parseArguments(argumentsList) {
	let fixture = null;
	let output = '.cache/selfhost-mvp/differential';
	for (const argument of argumentsList) {
		if (argument.startsWith('--fixture=')) fixture = nonEmpty(argument.slice('--fixture='.length), '--fixture');
		else if (argument.startsWith('--output=')) output = nonEmpty(argument.slice('--output='.length), '--output');
		else throw new Error(`Unknown argument: ${argument}`);
	}
	return { fixture, output };
}

function validateCorpus(value) {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Differential corpus must be an object');
	if (value.schemaVersion !== 1) throw new Error(`Unsupported differential corpus schema ${String(value.schemaVersion)}`);
	if (!Array.isArray(value.fixtures)) throw new Error('Differential corpus fixtures must be an array');
	const identifiers = new Set();
	const fixtures = value.fixtures.map((fixture, index) => {
		if (fixture === null || typeof fixture !== 'object' || Array.isArray(fixture)) throw new Error(`Fixture ${index} must be an object`);
		const id = nonEmpty(fixture.id, `fixtures[${index}].id`);
		if (identifiers.has(id)) throw new Error(`Duplicate differential fixture ${id}`);
		identifiers.add(id);
		if (!Array.isArray(fixture.tags) || fixture.tags.some(tag => typeof tag !== 'string' || tag.length === 0)) throw new Error(`Fixture ${id} tags must be non-empty strings`);
		const expectedDivergences = fixture.expectedDivergences ?? [];
		if (!Array.isArray(expectedDivergences)) throw new Error(`Fixture ${id} expectedDivergences must be an array`);
		return { id, tags: [...fixture.tags].sort(), input: validateKernelInput(fixture.input), expectedDivergences };
	});
	return { schemaVersion: 1, fixtures };
}

function nonEmpty(value, path) {
	if (typeof value !== 'string' || value.trim() === '') throw new Error(`${path} must be a non-empty string`);
	return value.trim();
}
