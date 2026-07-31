import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildProject } from '../src/project/project.js';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const mvpRoot = join(repositoryRoot, 'selfhost', 'mvp');
const temporaryRoot = join(repositoryRoot, '.test-tmp');

type ViruneResult<T> = { readonly $tag: 'Ok' | 'Err'; readonly $values: readonly [T] };
type Position = { readonly offset: number; readonly line: number; readonly column: number };
type Span = { readonly start: Position; readonly end: Position };
type PatternArm = { readonly kind: string; readonly name: string | null; readonly guarded: boolean; readonly span: Span };
type PatternCheck = { readonly target: string; readonly span: Span; readonly arms: readonly PatternArm[] };
type PatternCase = { readonly id: number; readonly name: string };
type ArmResult = {
	readonly index: number;
	readonly key: string | null;
	readonly guarded: boolean;
	readonly reachable: boolean;
	readonly coveredCaseId: number | null;
};
type Coverage = {
	readonly target: string;
	readonly targetTypeId: number | null;
	readonly spaceKind: string;
	readonly cases: readonly PatternCase[];
	readonly arms: readonly ArmResult[];
	readonly missingCaseIds: readonly number[];
	readonly missingCaseNames: readonly string[];
	readonly exhaustive: boolean;
};
type Diagnostic = { readonly code: string; readonly severity: string; readonly message: string; readonly span: Span; readonly help: string | null };
type CoverageResult = {
	readonly accepted: boolean;
	readonly typeCount: number;
	readonly checks: readonly Coverage[];
	readonly diagnostics: readonly Diagnostic[];
};
type CoverageModule = {
	readonly checkFrontendPatternCoverageContract: (request: string) => ViruneResult<string>;
};

const source = [
	'pub enum Status {',
	'\tPending',
	'\tComplete',
	'\tFailed(Int)',
	'}',
	'pub enum Response<T> {',
	'\tValue(T)',
	'\tMissing',
	'}',
	'pub type StatusTarget = Status',
	'pub type IntResponse = Response<Int>',
	'pub type BoolTarget = Bool',
	'pub type MaybeInt = Int?',
	'pub type Outcome = Result<Int, String>',
	'pub type IntTarget = Int',
	'pub type StringTarget = String',
	'',
].join('\n');

test('closed pattern spaces are canonical, exhaustive, and deterministic', async () => {
	const loaded = await loadCoverageModule();
	try {
		const request = {
			source,
			checks: [
				check('StatusTarget', [constructor('Pending', 20), constructor('Complete', 21), constructor('Failed', 22)], 19),
				check('IntResponse', [constructor('Value', 24), constructor('Missing', 25)], 23),
				check('BoolTarget', [boolean('true', 27), boolean('false', 28)], 26),
				check('MaybeInt', [constructor('Some', 30), constructor('None', 31)], 29),
				check('Outcome', [constructor('Ok', 33), constructor('Err', 34)], 32),
				check('IntTarget', [literal('1', 36), wildcard(37)], 35),
				check('StringTarget', [literal('value', 39), wildcard(40)], 38),
			],
		};
		const first = evaluate(loaded.module, request);
		const second = evaluate(loaded.module, request);
		assert.deepEqual(first, second);
		assert.equal(first.accepted, true, JSON.stringify(first.diagnostics, null, 2));
		assert.deepEqual(first.diagnostics, []);
		assert.ok(first.checks.every(item => item.exhaustive));
		assert.deepEqual(coverage(first, 'StatusTarget').cases.map(item => item.name), ['Pending', 'Complete', 'Failed']);
		assert.deepEqual(coverage(first, 'IntResponse').cases.map(item => item.name), ['Value', 'Missing']);
		assert.deepEqual(coverage(first, 'BoolTarget').cases.map(item => item.name), ['true', 'false']);
		assert.deepEqual(coverage(first, 'MaybeInt').cases.map(item => item.name), ['Some', 'None']);
		assert.deepEqual(coverage(first, 'Outcome').cases.map(item => item.name), ['Ok', 'Err']);
		assert.equal(coverage(first, 'IntTarget').spaceKind, 'int');
		assert.equal(coverage(first, 'StringTarget').spaceKind, 'string');
		validateReferences(first);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

test('missing, guarded, duplicate, and post-wildcard arms match legacy diagnostics', async () => {
	const loaded = await loadCoverageModule();
	try {
		const result = evaluate(loaded.module, {
			source,
			checks: [
				check('StatusTarget', [constructor('Pending', 50)], 49),
				check('BoolTarget', [boolean('true', 52)], 51),
				check('MaybeInt', [constructor('Some', 54, true), constructor('None', 55)], 53),
				check('Outcome', [constructor('Ok', 57)], 56),
				check('IntTarget', [literal('1', 59)], 58),
				check('StatusTarget', [constructor('Pending', 61), constructor('Pending', 62)], 60),
				check('StatusTarget', [wildcard(64), constructor('Complete', 65)], 63),
			],
		});
		assert.equal(result.accepted, false);
		assert.deepEqual(coverage(result, 'StatusTarget', 0).missingCaseNames, ['Complete', 'Failed']);
		assert.deepEqual(coverage(result, 'BoolTarget').missingCaseNames, ['false']);
		assert.deepEqual(coverage(result, 'MaybeInt').missingCaseNames, ['Some']);
		assert.deepEqual(coverage(result, 'Outcome').missingCaseNames, ['Err']);
		assert.equal(coverage(result, 'IntTarget').exhaustive, false);
		assert.equal(coverage(result, 'StatusTarget', 1).arms[1]?.reachable, false);
		assert.equal(coverage(result, 'StatusTarget', 2).exhaustive, true);
		assert.equal(coverage(result, 'StatusTarget', 2).arms[1]?.reachable, false);
		assert.ok(codes(result).includes('L3002'));
		assert.ok(codes(result).includes('L3003'));
		assert.ok(codes(result).includes('L3004'));
		assert.ok(codes(result).includes('L3005'));
		assert.ok(result.diagnostics.every(item => item.help !== null));
		validateReferences(result);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

test('unknown targets and malformed or guarded unknown arms return diagnostics instead of panicking', async () => {
	const loaded = await loadCoverageModule();
	try {
		const result = evaluate(loaded.module, {
			source,
			checks: [
				check('MissingType', [wildcard(71)], 70),
				check('StatusTarget', [{ kind: 'constructor', name: null, guarded: false, span: span(73) }], 72),
				check('StatusTarget', [constructor('Missing', 75, true)], 74),
			],
		});
		assert.equal(result.accepted, false);
		assert.ok(codes(result).includes('L2040'));
		assert.ok(codes(result).includes('L9001'));
		assert.equal(result.checks[0]?.targetTypeId, null);
		assert.equal(result.checks[0]?.exhaustive, false);
		assert.equal(result.checks[1]?.arms[0]?.reachable, false);
		assert.equal(result.checks[2]?.arms[0]?.reachable, false);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

function check(target: string, arms: readonly PatternArm[], line: number): PatternCheck {
	return { target, span: span(line), arms };
}

function constructor(name: string, line: number, guarded = false): PatternArm {
	return { kind: 'constructor', name, guarded, span: span(line) };
}

function boolean(name: 'true' | 'false', line: number): PatternArm {
	return { kind: 'boolean', name, guarded: false, span: span(line) };
}

function literal(name: string, line: number): PatternArm {
	return { kind: 'literal', name, guarded: false, span: span(line) };
}

function wildcard(line: number): PatternArm {
	return { kind: 'wildcard', name: null, guarded: false, span: span(line) };
}

function span(line: number): Span {
	return {
		start: { offset: line * 10, line, column: 1 },
		end: { offset: line * 10 + 5, line, column: 6 },
	};
}

function evaluate(module: CoverageModule, request: unknown): CoverageResult {
	const encoded = module.checkFrontendPatternCoverageContract(JSON.stringify(request));
	if (encoded.$tag !== 'Ok') throw new Error(`Pattern coverage contract failed: ${JSON.stringify(encoded.$values[0])}`);
	return JSON.parse(encoded.$values[0]) as CoverageResult;
}

function coverage(result: CoverageResult, target: string, occurrence = 0): Coverage {
	const values = result.checks.filter(item => item.target === target);
	const value = values[occurrence];
	assert.ok(value, `missing coverage ${target} at occurrence ${occurrence}`);
	return value;
}

function codes(result: CoverageResult): readonly string[] {
	return result.diagnostics.map(item => item.code);
}

function validateReferences(result: CoverageResult): void {
	for (const item of result.checks) {
		if (item.targetTypeId !== null) assert.ok(item.targetTypeId >= 0 && item.targetTypeId < result.typeCount);
		assert.deepEqual(item.cases.map(value => value.id), item.cases.map((_, index) => index));
		for (const id of item.missingCaseIds) assert.ok(id >= 0 && id < item.cases.length);
		for (const arm of item.arms) {
			if (arm.coveredCaseId !== null) assert.ok(arm.coveredCaseId >= 0 && arm.coveredCaseId < item.cases.length);
		}
	}
}

async function loadCoverageModule(): Promise<{ readonly root: string; readonly module: CoverageModule }> {
	const result = await buildProject(mvpRoot, { write: false });
	const errors = result.diagnostics.filter(item => item.severity === 'error');
	assert.deepEqual(errors.map(item => `${item.code}:${item.message}`), []);
	await mkdir(temporaryRoot, { recursive: true });
	const root = await mkdtemp(join(temporaryRoot, 'selfhost-pattern-coverage-'));
	const configuredOutDir = resolve(mvpRoot, 'dist');
	const outputPaths: string[] = [];
	for (const built of result.modules) {
		if (built.output === undefined || built.outputPath === undefined) continue;
		const outputPath = join(root, relative(configuredOutDir, built.outputPath));
		await mkdir(dirname(outputPath), { recursive: true });
		await writeFile(outputPath, built.output.code);
		outputPaths.push(outputPath);
	}
	for (const outputPath of outputPaths.sort()) await execFileAsync(process.execPath, ['--check', outputPath]);
	const moduleUrl = `${pathToFileURL(join(root, 'main.js')).href}?test=${Date.now()}`;
	return { root, module: await import(moduleUrl) as CoverageModule };
}
