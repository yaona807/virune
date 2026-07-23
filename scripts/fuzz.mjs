import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { compileSource } from '../packages/compiler/dist/src/index.js';
import { lex, parseSource } from '../packages/compiler/dist/src/experimental-api.js';
import { formatSource } from '../packages/formatter/dist/src/index.js';

class FuzzFailure extends Error {
	constructor(invariant, source, iteration, cause) {
		super(`Fuzz invariant failed: ${invariant}`, { cause });
		this.invariant = invariant;
		this.source = source;
		this.iteration = iteration;
		this.cause = cause;
	}
}

const root = resolve(import.meta.dirname, '..');
const artifactDirectory = resolve(process.env.VIRUNE_FUZZ_ARTIFACT_DIR ?? join(root, 'fuzz-regressions/artifacts'));
const durationMs = integerEnvironment('VIRUNE_FUZZ_DURATION_MS', 0);
const iterationLimit = integerEnvironment('VIRUNE_FUZZ_ITERATIONS', durationMs > 0 ? Number.MAX_SAFE_INTEGER : 2_000);
const shard = integerEnvironment('VIRUNE_FUZZ_SHARD', 0);
const seed = integerEnvironment('VIRUNE_FUZZ_SEED', 0x56_49_52_55 + shard * 0x9e3779b1) >>> 0;
const random = xorshift32(seed || 1);
const startedAt = Date.now();
let iterations = 0;
let validInputs = 0;
let formattedInputs = 0;

const validSeeds = [
	'fn main() -> Unit {\n\treturn Unit\n}\n',
	'pub fn add(left: Int, right: Int) -> Int {\n\treturn left + right\n}\n',
	'record User {\n\tname: String,\n\tage: Int,\n}\n',
	'enum ResultValue {\n\tOk(Int),\n\tErr(String),\n}\n',
	'fn values() -> List<Int> {\n\tlet items = [1, 2, 3]\n\treturn items\n}\n',
	'fn commented() -> Unit {\n\t// leading\n\tlet values = [\n\t\t1, // first\n\t\t// second\n\t\t2,\n\t]\n\treturn Unit\n}\n',
	'async fn load() -> Future<Unit> {\n\treturn async { return Unit }\n}\n',
];
const tokens = ['fn', 'let', 'return', 'record', 'enum', 'match', 'if', 'else', 'async', 'await', 'parallel', 'try', 'pub', 'mut', 'Int', 'String', 'Bool', 'Unit', 'Future', 'Result', 'List', 'Option', 'true', 'false', 'Unit', '0', '1', '2', '"text"', 'alpha', 'beta', 'value', '(', ')', '{', '}', '[', ']', '<', '>', ',', ':', '->', '=>', '=', '+', '-', '*', '/', '?', '\n', '\t', ' ', '// fuzz\n'];

try {
	while (iterations < iterationLimit && (durationMs === 0 || Date.now() - startedAt < durationMs)) {
		const source = generateCase(random, iterations);
		await verifyCase(source, iterations);
		iterations++;
	}
} catch (error) {
	const failure = error instanceof FuzzFailure ? error : new FuzzFailure('unexpected-exception', '<unavailable>', iterations, error);
	const path = await persistFailure(failure, { seed, shard, iterations });
	console.error(`[fuzz] failure=${failure.invariant} iteration=${failure.iteration} artifact=${path}`);
	console.error(failure.cause instanceof Error ? failure.cause.stack : failure.cause);
	process.exitCode = 1;
}

if (process.exitCode === undefined) {
	const summary = {
		seed,
		shard,
		iterations,
		validInputs,
		formattedInputs,
		durationMs: Date.now() - startedAt,
	};
	console.log(JSON.stringify(summary));
}

async function verifyCase(text, iteration) {
	const file = sourceFile(text);
	let first;
	let second;
	try {
		first = compileSource(file, { emit: true });
		second = compileSource(file, { emit: true });
	} catch (error) {
		throw new FuzzFailure('compiler-never-throws', text, iteration, error);
	}
	assertDiagnosticRanges(first.diagnostics, text, iteration);
	assertDiagnosticRanges(second.diagnostics, text, iteration);
	if (stableCompileResult(first) !== stableCompileResult(second)) {
		throw new FuzzFailure('compiler-determinism', text, iteration, new Error('Repeated compilation produced different diagnostics or output'));
	}

	let parsed;
	try {
		parsed = parseSource(file);
	} catch (error) {
		throw new FuzzFailure('parser-never-throws', text, iteration, error);
	}
	assertDiagnosticRanges(parsed.diagnostics, text, iteration);
	if (parsed.ast === undefined || parsed.diagnostics.some(item => item.severity === 'error')) return;
	validInputs++;

	let formatted;
	try {
		formatted = formatSource(text);
	} catch (error) {
		throw new FuzzFailure('formatter-never-throws', text, iteration, error);
	}
	if (formatted.errors.length > 0) throw new FuzzFailure('formatter-accepts-parseable-input', text, iteration, new Error(formatted.errors.join('\n')));
	formattedInputs++;
	const repeated = formatSource(formatted.text);
	if (repeated.errors.length > 0 || repeated.text !== formatted.text) {
		throw new FuzzFailure('formatter-idempotence', text, iteration, new Error(repeated.errors.join('\n') || 'format(format(source)) != format(source)'));
	}
	const reparsed = parseSource(sourceFile(formatted.text));
	if (reparsed.ast === undefined || reparsed.diagnostics.some(item => item.severity === 'error')) {
		throw new FuzzFailure('formatter-preserves-parseability', text, iteration, new Error(JSON.stringify(reparsed.diagnostics)));
	}
	const beforeComments = lex(text).comments.map(comment => normalizeCommentImage(comment.image));
	const afterComments = lex(formatted.text).comments.map(comment => normalizeCommentImage(comment.image));
	if (JSON.stringify(beforeComments) !== JSON.stringify(afterComments)) {
		throw new FuzzFailure('formatter-preserves-comments', text, iteration, new Error(`${JSON.stringify(beforeComments)} != ${JSON.stringify(afterComments)}`));
	}
}

function normalizeCommentImage(image) {
	return image.replace(/[ \t]+$/u, '');
}

function generateCase(next, iteration) {
	if (iteration % 3 !== 0) return mutate(validSeeds[Math.floor(next() * validSeeds.length)], next, 1 + Math.floor(next() * 8));
	const length = 4 + Math.floor(next() * 120);
	let output = '';
	for (let index = 0; index < length; index++) output += tokens[Math.floor(next() * tokens.length)];
	return output;
}

function mutate(seedText, next, count) {
	let output = seedText;
	for (let index = 0; index < count; index++) {
		const position = Math.floor(next() * (output.length + 1));
		const operation = Math.floor(next() * 4);
		if (operation === 0) output = `${output.slice(0, position)}${tokens[Math.floor(next() * tokens.length)]}${output.slice(position)}`;
		else if (operation === 1 && output.length > 0) {
			const end = Math.min(output.length, position + 1 + Math.floor(next() * 8));
			output = `${output.slice(0, position)}${output.slice(end)}`;
		} else if (operation === 2 && output.length > 1) {
			const end = Math.min(output.length, position + 1 + Math.floor(next() * 12));
			output = `${output.slice(0, position)}${output.slice(position, end).split('').reverse().join('')}${output.slice(end)}`;
		} else output = `${output.slice(0, position)}${String.fromCharCode(32 + Math.floor(next() * 95))}${output.slice(position)}`;
	}
	return output;
}

function assertDiagnosticRanges(diagnostics, text, iteration) {
	for (const diagnostic of diagnostics) {
		const { start, end } = diagnostic.span;
		if (!Number.isInteger(start.offset) || !Number.isInteger(end.offset) || start.offset < 0 || end.offset < start.offset || end.offset > text.length) {
			throw new FuzzFailure('diagnostic-range-within-source', text, iteration, new Error(JSON.stringify(diagnostic)));
		}
	}
}

function stableCompileResult(result) {
	return JSON.stringify({
		diagnostics: result.diagnostics,
		output: result.output,
	});
}

function sourceFile(text) {
	return { id: 1, path: '<fuzz>.virune', text };
}

function integerEnvironment(name, fallback) {
	const value = process.env[name];
	if (value === undefined) return fallback;
	const parsed = Number.parseInt(value, 10);
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

async function persistFailure(failure, context) {
	await mkdir(artifactDirectory, { recursive: true });
	const hash = createHash('sha256').update(failure.source).digest('hex').slice(0, 16);
	const base = `${failure.invariant}-${hash}`;
	const sourcePath = join(artifactDirectory, `${base}.virune`);
	const metadataPath = join(artifactDirectory, `${base}.json`);
	await writeFile(sourcePath, failure.source, 'utf8');
	await writeFile(metadataPath, `${JSON.stringify({
		schemaVersion: 1,
		invariant: failure.invariant,
		iteration: failure.iteration,
		...context,
		error: failure.cause instanceof Error ? { name: failure.cause.name, message: failure.cause.message, stack: failure.cause.stack } : String(failure.cause),
		sourceFile: `${base}.virune`,
	}, null, '\t')}\n`, 'utf8');
	return metadataPath;
}
