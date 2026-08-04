import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildProject } from '../src/project/project.js';
import {
	createSelfhostMvpKernel,
	type SelfhostMvpModule,
} from '../src/selfhost/mvp-adapter.js';
import { executeKernelOutputWithNode } from '../src/selfhost/node-executor.js';
import type { KernelInputV1 } from '../src/selfhost/contract.js';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const mvpRoot = join(repositoryRoot, 'selfhost', 'mvp');
const temporaryRoot = join(repositoryRoot, '.test-tmp');

const input = (text: string): KernelInputV1 => ({
	contractVersion: '1',
	languageVersion: '1.0',
	platform: 'node',
	entryPath: 'src/main.virune',
	sources: [{ path: 'src/main.virune', text }],
	interopManifest: { version: '1', modules: [] },
	emit: { target: 'es2022', sourceMap: false, sourcesContent: true },
});

const runtimeSource = [
	'fn unwrap(value: Int?) -> Int {',
	'\treturn match value {',
	'\t\tSome(item) => item',
	'\t\tNone => 0',
	'\t}',
	'}',
	'',
	'fn optionalValue(flag: Bool) -> Int? {',
	'\tif flag {',
	'\t\treturn Option.Some(7)',
	'\t}',
	'\treturn Option.None',
	'}',
	'',
	'fn resultValue(flag: Bool) -> Result<Int, String> {',
	'\tif flag {',
	'\t\treturn Result.Ok(9)',
	'\t}',
	'\treturn Result.Err("bad")',
	'}',
	'',
	'fn inferredValue() -> Int? {',
	'\tlet value = Some(11)',
	'\treturn value',
	'}',
	'',
	'fn conditionalValue(flag: Bool) -> Int? {',
	'\treturn if flag then Some(13) else None',
	'}',
	'',
	'fn matchValue(flag: Bool) -> Int? {',
	'\treturn match flag {',
	'\t\ttrue => Some(17)',
	'\t\t_ => None',
	'\t}',
	'}',
	'',
	'fn assignedValue() -> Int? {',
	'\tlet mut value: Int? = None',
	'\tvalue = Some(19)',
	'\treturn value',
	'}',
	'',
	'pub fn main() -> Int {',
	'\tlet optional = unwrap(optionalValue(true))',
	'\tlet result = match resultValue(true) {',
	'\t\tOk(value) => value',
	'\t\tErr(_) => 0',
	'\t}',
	'\tlet inferred = unwrap(inferredValue())',
	'\tlet argument = unwrap(Some(13))',
	'\tlet conditional = unwrap(conditionalValue(true))',
	'\tlet matched = unwrap(matchValue(true))',
	'\tlet assigned = unwrap(assignedValue())',
	'\treturn optional + result + inferred + argument + conditional + matched + assigned',
	'}',
	'',
].join('\n');

const unresolvedNoneSource = [
	'pub fn main() -> Int {',
	'\tlet missing = None',
	'\treturn 0',
	'}',
	'',
].join('\n');

const unresolvedResultSource = [
	'pub fn main() -> Int {',
	'\tlet unresolved = Ok(1)',
	'\treturn 0',
	'}',
	'',
].join('\n');

const incompatibleMatchSource = [
	'pub fn main() -> Int {',
	'\treturn match true {',
	'\t\ttrue => 1',
	'\t\t_ => "no"',
	'\t}',
	'}',
	'',
].join('\n');

test('Option and Result constructors resolve from expected types and execute', async () => {
	const loaded = await loadMvpModule();
	try {
		const request = input(runtimeSource);
		const output = await createSelfhostMvpKernel(loaded.module).compile(request);
		assert.equal(output.accepted, true, JSON.stringify(output.diagnostics, null, 2));
		assert.deepEqual(output.diagnostics, []);
		const emittedCode = output.emittedModules.map(module => module.code).join('\n');
		assert.match(emittedCode, /Some\(7\)/);
		assert.match(emittedCode, /return None;/);
		assert.match(emittedCode, /Ok\(9\)/);
		assert.match(emittedCode, /Err\("bad"\)/);
		assert.match(emittedCode, /Some\(13\)/);
		assert.match(emittedCode, /Some\(17\)/);
		assert.match(emittedCode, /Some\(19\)/);
		assert.doesNotMatch(emittedCode, /(?:Some|Ok|Err)\([^)]*, \$ctx\)/);
		const runtime = await executeKernelOutputWithNode(request, output);
		assert.equal(runtime.returnValue, 89);
		assert.equal(runtime.panic, null);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

test('None without an expected Optional type reports an inference diagnostic', async () => {
	const loaded = await loadMvpModule();
	try {
		const output = await createSelfhostMvpKernel(loaded.module).compile(input(unresolvedNoneSource));
		assert.equal(output.accepted, false);
		assert.equal(output.diagnostics[0]?.code, 'L2020');
		assert.match(output.diagnostics[0]?.message ?? '', /Cannot infer the Optional type of None/);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

test('Ok or Err without an expected Result type reports an inference diagnostic', async () => {
	const loaded = await loadMvpModule();
	try {
		const output = await createSelfhostMvpKernel(loaded.module).compile(input(unresolvedResultSource));
		assert.equal(output.accepted, false);
		assert.equal(output.diagnostics[0]?.code, 'L2020');
		assert.match(output.diagnostics[0]?.message ?? '', /Cannot infer the complete Result type for Ok/);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

test('contextual constructor fallback preserves match-arm compatibility diagnostics', async () => {
	const loaded = await loadMvpModule();
	try {
		const output = await createSelfhostMvpKernel(loaded.module).compile(input(incompatibleMatchSource));
		assert.equal(output.accepted, false);
		assert.equal(output.diagnostics[0]?.code, 'L2043');
		assert.equal(output.diagnostics[0]?.message, 'Match arms must produce the same type');
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

async function loadMvpModule(): Promise<{ readonly root: string; readonly module: SelfhostMvpModule }> {
	const result = await buildProject(mvpRoot, { write: false });
	const errors = result.diagnostics.filter(item => item.severity === 'error');
	assert.deepEqual(errors.map(item => item.code + ':' + item.message), []);

	await mkdir(temporaryRoot, { recursive: true });
	const root = await mkdtemp(join(temporaryRoot, 'selfhost-variant-constructors-'));
	const configuredOutDir = resolve(mvpRoot, 'dist');
	const outputPaths: string[] = [];
	for (const built of result.modules) {
		if (built.output === undefined || built.outputPath === undefined) continue;
		const outputPath = join(root, relative(configuredOutDir, built.outputPath));
		await mkdir(dirname(outputPath), { recursive: true });
		await writeFile(outputPath, built.output.code);
		outputPaths.push(outputPath);
	}
	for (const outputPath of outputPaths.sort()) {
		await execFileAsync(process.execPath, ['--check', outputPath]);
	}
	const moduleUrl = pathToFileURL(join(root, 'main.js')).href + '?test=' + Date.now();
	return { root, module: await import(moduleUrl) as SelfhostMvpModule };
}
