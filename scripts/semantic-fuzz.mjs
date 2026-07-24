import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = resolve(import.meta.dirname, '..');
const defaultArtifactDirectory = resolve(repositoryRoot, 'fuzz-regressions/semantic-artifacts');

export async function runSemanticFuzz(options = {}) {
	const shard = nonNegativeInteger(options.shard ?? process.env.VIRUNE_SEMANTIC_FUZZ_SHARD, 0, 'shard');
	const durationMs = nonNegativeInteger(options.durationMs ?? process.env.VIRUNE_SEMANTIC_FUZZ_DURATION_MS, 0, 'durationMs');
	const defaultIterations = durationMs > 0 ? Number.MAX_SAFE_INTEGER : 12;
	const iterationLimit = nonNegativeInteger(options.iterations ?? process.env.VIRUNE_SEMANTIC_FUZZ_ITERATIONS, defaultIterations, 'iterations');
	const seed = nonNegativeInteger(options.seed ?? process.env.VIRUNE_SEMANTIC_FUZZ_SEED, 0x53_45_4d_41 + shard * 0x9e3779b1, 'seed') >>> 0;
	const artifactDirectory = resolve(options.artifactDirectory ?? process.env.VIRUNE_SEMANTIC_FUZZ_ARTIFACT_DIR ?? defaultArtifactDirectory);
	const workDirectory = resolve(options.workDirectory ?? join(repositoryRoot, '.cache/semantic-fuzz', `shard-${shard}`));
	const next = xorshift32(seed || 1);
	const startedAt = Date.now();
	let iterations = 0;
	await rm(workDirectory, { recursive: true, force: true });
	await mkdir(workDirectory, { recursive: true });
	try {
		while (iterations < iterationLimit && (durationMs === 0 || Date.now() - startedAt < durationMs)) {
			const fuzzCase = generateSemanticCase(next, iterations);
			try {
				await verifySemanticCase(fuzzCase, { workDirectory, iteration: iterations });
			} catch (error) {
				const minimized = await minimizeFailure(
					fuzzCase,
					error,
					candidate => verifySemanticCase(candidate, { workDirectory, iteration: iterations }),
				);
				const artifact = await persistFailure(minimized.fuzzCase, minimized.error, {
					artifactDirectory,
					seed,
					shard,
					iteration: iterations,
				});
				throw new Error(`Semantic fuzz failed at iteration ${iterations}; artifact=${artifact}`, { cause: error });
			}
			iterations++;
		}
	} finally {
		await rm(workDirectory, { recursive: true, force: true });
	}
	const summary = { schemaVersion: 1, seed, shard, iterations, durationMs: Date.now() - startedAt };
	console.log(JSON.stringify(summary));
	return summary;
}

export function generateSemanticCase(next, iteration = 0) {
	const template = TEMPLATES[Math.floor(next() * TEMPLATES.length)];
	const parameters = template.parameters(next);
	return { schemaVersion: 1, iteration, template: template.name, parameters };
}

export function renderSemanticCase(fuzzCase, variant = 'original') {
	const template = templateFor(fuzzCase);
	const names = variant === 'renamed'
		? { value: 'candidateValue', total: 'accumulatedTotal', item: 'currentItem', helper: 'transformValue' }
		: { value: 'value', total: 'total', item: 'item', helper: 'helper' };
	let source = template.render(fuzzCase.parameters, names, variant === 'parenthesized');
	if (variant === 'commented') {
		source = `// semantic fuzz case ${fuzzCase.iteration}\n// comments and whitespace must not change execution\n${source}`;
	}
	return source;
}

async function verifySemanticCase(fuzzCase, context) {
	const { compileSource, evaluatePureFunction, formatSource } = await loadToolchain();
	const template = templateFor(fuzzCase);
	const variants = ['original', 'formatted', 'commented', 'renamed', 'parenthesized'];
	let baseline;
	for (const variant of variants) {
		let source = renderSemanticCase(fuzzCase, variant === 'formatted' ? 'original' : variant);
		if (variant === 'formatted') {
			const formatted = formatSource(source);
			if (formatted.errors.length > 0) {
				throw new SemanticFuzzFailure('Formatter rejected semantic fuzz input', { variant, source, errors: formatted.errors });
			}
			source = formatted.text;
		}
		const result = compileSource(sourceFile(source), { emit: true, outputFile: 'main.js', platform: 'node' });
		const errors = result.diagnostics.filter(item => item.severity === 'error');
		if (errors.length > 0 || result.ast === undefined || result.output === undefined) {
			throw new SemanticFuzzFailure('Generated semantic fuzz program did not compile', { variant, source, diagnostics: errors });
		}
		const expected = normalize(template.expected === undefined
			? evaluatePureFunction(result.ast, 'probe')
			: template.expected(fuzzCase.parameters));
		if (baseline === undefined) baseline = expected;
		else ensureEqual(expected, baseline, `${variant} changed expected semantics`, {
			variant,
			source,
			emittedCode: result.output.code,
		});
		const actual = normalize(await executeEmitted(result.output.code, context, `${fuzzCase.iteration}-${variant}-direct`));
		ensureEqual(actual, expected, `${variant} emitted JavaScript disagrees with the semantic oracle`, {
			variant,
			source,
			emittedCode: result.output.code,
		});
	}
	await verifyIncrementalBuild(fuzzCase, context, baseline, formatSource);
}

async function verifyIncrementalBuild(fuzzCase, context, expected, formatSource) {
	const { IncrementalProjectBuilder } = await loadToolchain();
	const projectRoot = join(context.workDirectory, `case-${context.iteration}`);
	await rm(projectRoot, { recursive: true, force: true });
	await mkdir(join(projectRoot, 'src'), { recursive: true });
	await writeFile(join(projectRoot, 'virune.json'), `${JSON.stringify({
		languageVersion: '1.0',
		platform: 'node',
		sourceDir: 'src',
		outDir: 'dist',
		entry: 'src/main.virune',
		target: 'es2022',
		sourceMap: false,
		sourcesContent: false,
	}, null, '\t')}\n`, 'utf8');
	const sourcePath = join(projectRoot, 'src/main.virune');
	const outputPath = join(projectRoot, 'dist/main.js');
	const builder = new IncrementalProjectBuilder();
	const original = renderSemanticCase(fuzzCase, 'original');
	await writeFile(sourcePath, original, 'utf8');
	const clean = await builder.build(projectRoot, { write: true });
	assertNoBuildErrors(clean, 'clean');
	const cleanCode = await readFile(outputPath, 'utf8');
	ensureEqual(normalize(await importProbe(outputPath, `${context.iteration}-clean`)), expected, 'clean project build disagrees with semantic oracle', {
		source: original,
		emittedCode: cleanCode,
	});

	const unchanged = await builder.build(projectRoot, { write: true });
	assertNoBuildErrors(unchanged, 'unchanged incremental');
	assert.equal(await readFile(outputPath, 'utf8'), cleanCode, 'unchanged incremental build changed emitted JavaScript');

	const formatted = formatSource(original);
	if (formatted.errors.length > 0) throw new SemanticFuzzFailure('Formatter rejected project input', { source: original, errors: formatted.errors });
	await writeFile(sourcePath, formatted.text, 'utf8');
	const incremental = await builder.build(projectRoot, { write: true });
	assertNoBuildErrors(incremental, 'formatted incremental');
	const incrementalCode = await readFile(outputPath, 'utf8');
	ensureEqual(normalize(await importProbe(outputPath, `${context.iteration}-incremental`)), expected, 'incremental formatted build disagrees with semantic oracle', {
		source: formatted.text,
		emittedCode: incrementalCode,
	});

	const cleanBuilder = new IncrementalProjectBuilder();
	const rebuilt = await cleanBuilder.build(projectRoot, { write: true });
	assertNoBuildErrors(rebuilt, 'formatted clean');
	const rebuiltCode = await readFile(outputPath, 'utf8');
	ensureEqual(normalize(await importProbe(outputPath, `${context.iteration}-rebuilt`)), expected, 'clean formatted rebuild disagrees with semantic oracle', {
		source: formatted.text,
		emittedCode: rebuiltCode,
	});
}

function assertNoBuildErrors(result, phase) {
	const errors = result.diagnostics.filter(item => item.severity === 'error');
	if (errors.length > 0) throw new SemanticFuzzFailure(`${phase} build failed`, { diagnostics: errors });
}

async function executeEmitted(code, context, key) {
	const path = join(context.workDirectory, `direct-${key}.mjs`);
	await writeFile(path, code, 'utf8');
	return importProbe(path, key);
}

async function importProbe(path, key) {
	const module = await import(`${pathToFileURL(path).href}?semantic-fuzz=${encodeURIComponent(key)}-${Date.now()}`);
	if (typeof module.probe !== 'function') throw new SemanticFuzzFailure('Emitted module does not export probe()', { path });
	return module.probe();
}

async function minimizeFailure(fuzzCase, initialError, verify) {
	let current = fuzzCase;
	let currentError = initialError;
	for (const parameters of shrinkParameters(fuzzCase.parameters)) {
		const candidate = { ...fuzzCase, parameters };
		try { await verify(candidate); }
		catch (error) { current = candidate; currentError = error; }
	}
	return { fuzzCase: current, error: currentError };
}

export function shrinkParameters(parameters) {
	const candidates = [];
	for (const [key, value] of Object.entries(parameters)) {
		if (typeof value !== 'number' || value === 0) continue;
		for (const replacement of [0, Math.sign(value), Math.trunc(value / 2)]) {
			if (replacement !== value) candidates.push({ ...parameters, [key]: replacement });
		}
	}
	return candidates;
}

async function persistFailure(fuzzCase, error, context) {
	await mkdir(context.artifactDirectory, { recursive: true });
	const source = renderSemanticCase(fuzzCase, 'original');
	const hash = createHash('sha256').update(source).digest('hex').slice(0, 16);
	const base = `semantic-${fuzzCase.template}-${hash}`;
	await writeFile(join(context.artifactDirectory, `${base}.virune`), source, 'utf8');
	const details = error instanceof SemanticFuzzFailure ? error.details : undefined;
	if (typeof details?.emittedCode === 'string') {
		await writeFile(join(context.artifactDirectory, `${base}.mjs`), details.emittedCode, 'utf8');
	}
	const metadataPath = join(context.artifactDirectory, `${base}.json`);
	await writeFile(metadataPath, `${JSON.stringify({
		schemaVersion: 1,
		...context,
		case: fuzzCase,
		replayCommand: `VIRUNE_SEMANTIC_FUZZ_SEED=${context.seed} VIRUNE_SEMANTIC_FUZZ_SHARD=${context.shard} VIRUNE_SEMANTIC_FUZZ_ITERATIONS=${context.iteration + 1} npm run test:semantic-fuzz:smoke`,
		error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error),
		details,
		sourceFile: `${base}.virune`,
	}, null, '\t')}\n`, 'utf8');
	return metadataPath;
}

class SemanticFuzzFailure extends Error {
	constructor(message, details) {
		super(message);
		this.name = 'SemanticFuzzFailure';
		this.details = details;
	}
}

function ensureEqual(actual, expected, message, details = {}) {
	try { assert.deepEqual(actual, expected); }
	catch (cause) {
		throw new SemanticFuzzFailure(message, {
			...details,
			expected,
			actual,
			cause: cause instanceof Error ? cause.message : String(cause),
		});
	}
}

function sourceFile(text) { return { id: 1, path: 'semantic-fuzz.virune', text }; }
function normalize(value) {
	if (Array.isArray(value)) return value.map(normalize);
	if (value !== null && typeof value === 'object') {
		return Object.fromEntries(Object.entries(value)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, item]) => [key, normalize(item)]));
	}
	return value;
}
function nonNegativeInteger(value, fallback, name) {
	if (value === undefined) return fallback;
	const parsed = typeof value === 'number' ? value : Number.parseInt(value, 10);
	if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer`);
	return parsed;
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
function integer(next, minimum = -20, maximum = 20) { return minimum + Math.floor(next() * (maximum - minimum + 1)); }
function nonZeroInteger(next) { const value = integer(next, -9, 9); return value === 0 ? 1 : value; }
function wrap(expression, parenthesized) { return parenthesized ? `(${expression})` : expression; }
function templateFor(fuzzCase) {
	const template = TEMPLATES_BY_NAME.get(fuzzCase.template);
	if (template === undefined) throw new Error(`Unknown semantic fuzz template: ${fuzzCase.template}`);
	return template;
}

const TEMPLATES = [
	{
		name: 'arithmetic-branch',
		parameters: next => ({ start: integer(next), multiply: nonZeroInteger(next), add: integer(next), threshold: integer(next), thenDelta: integer(next), elseDelta: integer(next) }),
		render: (p, n, paren) => `fn ${n.helper}(${n.value}: Int) -> Int => ${wrap(`${n.value} * ${p.multiply} + ${p.add}`, paren)}\n\n@jsExport\npub fn probe() -> Int {\n\tlet mut ${n.value} = ${p.start}\n\t${n.value} = ${n.helper}(${n.value})\n\tif ${n.value} > ${p.threshold} {\n\t\t${n.value} = ${wrap(`${n.value} - ${p.thenDelta}`, paren)}\n\t} else {\n\t\t${n.value} = ${wrap(`${n.value} + ${p.elseDelta}`, paren)}\n\t}\n\treturn ${n.value}\n}\n`,
	},
	{
		name: 'list-fold',
		parameters: next => ({ a: integer(next), b: integer(next), c: integer(next), offset: integer(next) }),
		render: (p, n, paren) => `@jsExport\npub fn probe() -> Int {\n\tlet mut ${n.total} = ${p.offset}\n\tfor ${n.item} in [${p.a}, ${p.b}, ${p.c}] {\n\t\t${n.total} = ${wrap(`${n.total} + ${n.item}`, paren)}\n\t}\n\treturn ${n.total}\n}\n`,
	},
	{
		name: 'literal-match',
		parameters: next => ({ value: integer(next, 0, 3), zero: integer(next), one: integer(next), fallback: integer(next) }),
		render: (p, n, paren) => `@jsExport\npub fn probe() -> Int {\n\tlet ${n.value} = ${p.value}\n\treturn match ${n.value} {\n\t\t0 => ${wrap(String(p.zero), paren)}\n\t\t1 => ${wrap(String(p.one), paren)}\n\t\t_ => ${wrap(String(p.fallback), paren)}\n\t}\n}\n`,
	},
	{
		name: 'tuple-roundtrip',
		parameters: next => ({ left: integer(next), right: integer(next) }),
		render: (p, n, paren) => `fn ${n.helper}(${n.value}: (Int, Int)) -> (Int, Int) {\n\treturn match ${n.value} {\n\t\t(a, b) => (${wrap('b + 1', paren)}, ${wrap('a - 1', paren)})\n\t}\n}\n\n@jsExport\npub fn probe() -> (Int, Int) {\n\treturn ${n.helper}((${p.left}, ${p.right}))\n}\n`,
	},
	{
		name: 'record-field',
		parameters: next => ({ value: integer(next), delta: integer(next) }),
		render: (p, _n, paren) => `record Box {\n\tvalue: Int\n}\n\n@jsExport\npub fn probe() -> Int {\n\tlet box = Box { value: ${p.value}, }\n\treturn ${wrap(`box.value + ${p.delta}`, paren)}\n}\n`,
	},
	{
		name: 'result-branch',
		parameters: next => ({ ok: next() >= 0.5, value: integer(next) }),
		expected: p => p.ok ? { $tag: 'Ok', $values: [p.value] } : { $tag: 'Err', $values: ['semantic failure'] },
		render: p => `@jsExport\npub fn probe() -> Result<Int, String> {\n\tif ${p.ok ? 'true' : 'false'} {\n\t\treturn Ok(${p.value})\n\t}\n\treturn Err("semantic failure")\n}\n`,
	},
	{
		name: 'async-await',
		parameters: next => ({ value: integer(next), delta: integer(next) }),
		expected: p => p.value + p.delta,
		render: (p, n, paren) => `async fn ${n.helper}(${n.value}: Int) -> Int {\n\treturn ${wrap(`${n.value} + ${p.delta}`, paren)}\n}\n\n@jsExport\npub async fn probe() -> Int {\n\treturn await ${n.helper}(${p.value})\n}\n`,
	},
];
const TEMPLATES_BY_NAME = new Map(TEMPLATES.map(template => [template.name, template]));

let toolchainPromise;
async function loadToolchain() {
	toolchainPromise ??= Promise.all([
		import('../packages/compiler/dist/src/experimental-api.js'),
		import('../packages/compiler/dist/src/reference/evaluator.js'),
		import('../packages/formatter/dist/src/index.js'),
	]).then(([compiler, evaluator, formatter]) => ({
		compileSource: compiler.compileSource,
		IncrementalProjectBuilder: compiler.IncrementalProjectBuilder,
		evaluatePureFunction: evaluator.evaluatePureFunction,
		formatSource: formatter.formatSource,
	}));
	return toolchainPromise;
}

const entry = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (entry === fileURLToPath(import.meta.url)) await runSemanticFuzz();
