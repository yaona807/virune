import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { generateSemanticCase, renderSemanticCase } from './semantic-fuzz.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');
const selfhostModulePath = resolve(repositoryRoot, 'selfhost/mvp/dist/main.js');
const DEFAULT_SEED = 0x53_44_46_31;
const DEFAULT_ITERATIONS = 32;
const DEFAULT_OUTPUT = '.cache/selfhost-semantic-differential-fuzz';

export function generateSemanticDifferentialFixtures({ seed = DEFAULT_SEED, iterations = DEFAULT_ITERATIONS } = {}) {
	const normalizedSeed = uint32(seed, DEFAULT_SEED, 'seed');
	const normalizedIterations = positiveInteger(iterations, DEFAULT_ITERATIONS, 'iterations');
	const next = xorshift32(normalizedSeed || 1);
	return Array.from({ length: normalizedIterations }, (_, iteration) => {
		const fuzzCase = generateSemanticCase(next, iteration);
		const source = renderSemanticCase(fuzzCase, 'original');
		return {
			id: `semantic-fuzz-${String(iteration).padStart(4, '0')}-${fuzzCase.template}`,
			tags: ['semantic-fuzz', 'project', 'runtime'],
			input: {
				contractVersion: '1',
				languageVersion: '1.0',
				platform: 'node',
				entryPath: 'src/main.virune',
				sources: [{ path: 'src/main.virune', text: source }],
				interopManifest: { version: '1', modules: [] },
				emit: { target: 'es2022', sourceMap: false, sourcesContent: true },
			},
			expectedDivergences: [],
		};
	});
}

export function adaptKernelOutputForProbe(input, output) {
	if (!output.accepted) return output;
	const entryIndex = output.emittedModules.findIndex(module => module.sourcePath === input.entryPath);
	if (entryIndex < 0) return output;
	const emittedModules = output.emittedModules.map((module, index) => index === entryIndex
		? {
			...module,
			code: `${module.code}${module.code.endsWith('\n') ? '' : '\n'}\nexport async function main() {\n\treturn await probe();\n}\n`,
		}
		: module);
	return { ...output, emittedModules };
}

export function parseSemanticDifferentialArguments(argumentsList) {
	let seed;
	let iterations;
	let output;
	for (const argument of argumentsList) {
		if (argument.startsWith('--seed=')) seed = nonEmpty(argument.slice('--seed='.length), '--seed');
		else if (argument.startsWith('--iterations=')) iterations = nonEmpty(argument.slice('--iterations='.length), '--iterations');
		else if (argument.startsWith('--output=')) output = nonEmpty(argument.slice('--output='.length), '--output');
		else throw new Error(`Unknown argument: ${argument}`);
	}
	return { seed, iterations, output };
}

export async function runSelfhostSemanticDifferentialFuzz(options = {}) {
	const seed = uint32(options.seed ?? process.env.VIRUNE_SELFHOST_SEMANTIC_DIFFERENTIAL_SEED, DEFAULT_SEED, 'seed');
	const iterations = positiveInteger(options.iterations ?? process.env.VIRUNE_SELFHOST_SEMANTIC_DIFFERENTIAL_ITERATIONS, DEFAULT_ITERATIONS, 'iterations');
	const output = nonEmpty(options.output ?? process.env.VIRUNE_SELFHOST_SEMANTIC_DIFFERENTIAL_OUTPUT ?? DEFAULT_OUTPUT, 'output');
	const outputDirectory = resolve(repositoryRoot, output);
	const fixtures = generateSemanticDifferentialFixtures({ seed, iterations });
	await writeGenerationEvidence(outputDirectory, { fixtures, iterations, seed });

	const [
		{ writeDifferentialArtifacts },
		{ runDifferentialCorpus },
		{ compileWithLegacyKernel },
		{ executeKernelOutputWithNode },
		{ createSelfhostProjectKernel },
	] = await Promise.all([
		import('../packages/compiler/dist/src/selfhost/differential-artifacts.js'),
		import('../packages/compiler/dist/src/selfhost/differential-harness.js'),
		import('../packages/compiler/dist/src/selfhost/legacy-adapter.js'),
		import('../packages/compiler/dist/src/selfhost/node-executor.js'),
		import('../packages/compiler/dist/src/selfhost/project-differential-adapter.js'),
	]);
	const selfhostModule = await import(pathToFileURL(selfhostModulePath).href);
	const executeProbe = (input, result) => executeKernelOutputWithNode(input, adaptKernelOutputForProbe(input, result));
	const selfhost = createSelfhostProjectKernel(selfhostModule);
	const report = await runDifferentialCorpus({
		fixtures,
		left: {
			name: 'legacy-semantic-fuzz',
			compile: compileWithLegacyKernel,
			execute: executeProbe,
		},
		right: {
			...selfhost,
			name: 'selfhost-project-semantic-fuzz',
			execute: executeProbe,
		},
	});
	const artifacts = await writeDifferentialArtifacts(report, outputDirectory);
	console.log(`Self-host semantic differential fuzz: ${report.passed ? 'PASS' : 'FAIL'}`);
	console.log(`Seed: ${seed}; iterations: ${iterations}; failed: ${report.totals.failed}`);
	console.log(`JSON: ${artifacts.jsonPath}`);
	console.log(`Summary: ${artifacts.summaryPath}`);
	if (!report.passed) process.exitCode = 1;
	return { report, seed, iterations, outputDirectory };
}

async function writeGenerationEvidence(outputDirectory, { fixtures, iterations, seed }) {
	await mkdir(outputDirectory, { recursive: true });
	const evidence = {
		schemaVersion: 1,
		claim: 'selfhost-semantic-differential-fuzz-generation',
		seed,
		iterations,
		fixtures: fixtures.map(fixture => ({
			id: fixture.id,
			sourceSha256: createHash('sha256').update(fixture.input.sources[0].text).digest('hex'),
		})),
		replayCommand: `npm run selfhost:mvp:build && node scripts/run-selfhost-semantic-differential-fuzz.mjs --seed=${seed} --iterations=${iterations} --output=${DEFAULT_OUTPUT}`,
	};
	await writeFile(resolve(outputDirectory, 'generation.json'), `${JSON.stringify(evidence, null, '\t')}\n`, 'utf8');
}

function uint32(value, fallback, name) {
	const parsed = unsignedInteger(value, fallback, name);
	if (parsed > 0xffff_ffff) throw new Error(`${name} must be a uint32`);
	return parsed >>> 0;
}

function positiveInteger(value, fallback, name) {
	const parsed = unsignedInteger(value, fallback, name);
	if (parsed === 0) throw new Error(`${name} must be greater than zero`);
	return parsed;
}

function unsignedInteger(value, fallback, name) {
	if (value === undefined) return fallback;
	if (typeof value === 'number') {
		if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
		return value;
	}
	if (typeof value !== 'string' || !/^\d+$/u.test(value)) throw new Error(`${name} must be a non-negative integer`);
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed)) throw new Error(`${name} must be a non-negative integer`);
	return parsed;
}

function nonEmpty(value, name) {
	if (typeof value !== 'string' || value.trim() === '') throw new Error(`${name} must be a non-empty string`);
	return value.trim();
}

function xorshift32(initial) {
	let state = initial >>> 0;
	return () => {
		state ^= state << 13;
		state ^= state >>> 17;
		state ^= state << 5;
		return (state >>> 0) / 0x1_0000_0000;
	};
}

const entry = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (entry === fileURLToPath(import.meta.url)) {
	await runSelfhostSemanticDifferentialFuzz(parseSemanticDifferentialArguments(process.argv.slice(2)));
}
