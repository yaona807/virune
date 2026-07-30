import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateKernelInput } from '../packages/compiler/dist/src/selfhost/contract.js';
import { writeDifferentialArtifacts } from '../packages/compiler/dist/src/selfhost/differential-artifacts.js';
import { runDifferentialCorpus } from '../packages/compiler/dist/src/selfhost/differential-harness.js';
import { compileWithLegacyKernel } from '../packages/compiler/dist/src/selfhost/legacy-adapter.js';
import { executeKernelOutputWithNode } from '../packages/compiler/dist/src/selfhost/node-executor.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const corpusPath = resolve(root, '.github/self-hosting/differential-corpus-v1.json');
const options = parseArguments(process.argv.slice(2));
const corpus = validateCorpus(JSON.parse(await readFile(corpusPath, 'utf8')));
const fixtures = corpus.fixtures.filter(fixture => {
	if (options.fixture !== null) return fixture.id === options.fixture;
	return fixture.tags.includes(options.tag);
});
if (fixtures.length === 0) throw new Error(`No differential fixtures matched ${options.fixture ?? `tag ${options.tag}`}`);

const legacy = {
	name: 'legacy',
	compile: compileWithLegacyKernel,
	execute: executeKernelOutputWithNode,
};
const report = await runDifferentialCorpus({
	fixtures,
	left: legacy,
	right: { ...legacy, name: 'legacy-reference' },
});
const outputDirectory = resolve(root, options.output);
const artifacts = await writeDifferentialArtifacts(report, outputDirectory);
console.log(`Self-host differential corpus: ${report.passed ? 'PASS' : 'FAIL'}`);
console.log(`Fixtures: ${report.totals.fixtures}; matched: ${report.totals.matched}; expected divergence: ${report.totals.expectedDivergence}; failed: ${report.totals.failed}`);
console.log(`JSON: ${artifacts.jsonPath}`);
console.log(`Summary: ${artifacts.summaryPath}`);
if (!report.passed) process.exitCode = 1;

function parseArguments(argumentsList) {
	let fixture = null;
	let tag = 'smoke';
	let output = '.cache/selfhost-differential/smoke';
	for (const argument of argumentsList) {
		if (argument.startsWith('--fixture=')) fixture = nonEmpty(argument.slice('--fixture='.length), '--fixture');
		else if (argument.startsWith('--tag=')) tag = nonEmpty(argument.slice('--tag='.length), '--tag');
		else if (argument.startsWith('--output=')) output = nonEmpty(argument.slice('--output='.length), '--output');
		else throw new Error(`Unknown argument: ${argument}`);
	}
	return { fixture, tag, output };
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
		return {
			id,
			tags: [...fixture.tags].sort(),
			input: validateKernelInput(fixture.input),
			expectedDivergences,
		};
	});
	return { schemaVersion: 1, fixtures };
}

function nonEmpty(value, path) {
	if (typeof value !== 'string' || value.trim() === '') throw new Error(`${path} must be a non-empty string`);
	return value.trim();
}
