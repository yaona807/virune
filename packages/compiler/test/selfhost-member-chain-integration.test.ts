import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildProject } from '../src/project/project.js';
import { createSelfhostMvpKernel, type SelfhostMvpModule } from '../src/selfhost/mvp-adapter.js';
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
	'fn identity(value: Int) -> Int {',
	'\treturn value',
	'}',
	'',
	'fn makePosition(offset: Int, line: Int, column: Int) -> MvpPosition {',
	'\treturn MvpPosition { offset: offset, line: line, column: column }',
	'}',
	'',
	'fn makeToken() -> MvpToken {',
	'\treturn MvpToken {',
	'\t\tkind: "Identifier",',
	'\t\ttext: "name",',
	'\t\tspan: MvpSpan {',
	'\t\t\tstart: makePosition(1, 2, 3),',
	'\t\t\tend: makePosition(4, 5, 6),',
	'\t\t},',
	'\t}',
	'}',
	'',
	'fn makeCallable() -> CallableHolder {',
	'\treturn CallableHolder { callback: identity }',
	'}',
	'',
	'fn qualified(position: MvpPosition) -> Int {',
	'\treturn position.line',
	'}',
	'',
	'pub fn main() -> Int {',
	'\tlet positions = [makePosition(1, 2, 3)]',
	'\treturn makeToken().span.start.offset',
	'\t\t+ positions[0].line',
	'\t\t+ (makeToken()).span.end.column',
	'\t\t+ makeCallable().callback(4)',
	'\t\t+ qualified(makePosition(0, 7, 0))',
	'}',
	'',
].join('\n');

const missingFieldSource = [
	'pub fn main(value: MvpPosition) -> Int {',
	'\treturn value.missing',
	'}',
	'',
].join('\n');

const nonCallableSource = [
	'pub fn main(value: Int) -> Int {',
	'\treturn (value)(1)',
	'}',
	'',
].join('\n');

test('member chains resolve typed fields and callable fields through the generated compiler', async () => {
	const loaded = await loadMvpModule();
	try {
		const request = input(runtimeSource);
		const output = await createSelfhostMvpKernel(loaded.module).compile(request);
		assert.equal(output.accepted, true, JSON.stringify(output.diagnostics, null, 2));
		assert.deepEqual(output.diagnostics, []);
		const emittedCode = output.emittedModules.map(module => module.code).join('\n');
		assert.match(emittedCode, /\)\.span\)\.start\)\.offset/);
		assert.match(emittedCode, /\)\.callback\)\(4, \$ctx\)/);
		const runtime = await executeKernelOutputWithNode(request, output);
		assert.equal(runtime.returnValue, 20);
		assert.equal(runtime.panic, null);

		const missingField = await createSelfhostMvpKernel(loaded.module).compile(input(missingFieldSource));
		assert.equal(missingField.accepted, false);
		assert.equal(missingField.diagnostics[0]?.code, 'L2014');
		assert.equal(missingField.diagnostics[0]?.message, 'Type MvpPosition has no field missing');

		const nonCallable = await createSelfhostMvpKernel(loaded.module).compile(input(nonCallableSource));
		assert.equal(nonCallable.accepted, false);
		assert.equal(nonCallable.diagnostics[0]?.code, 'L2012');
		assert.equal(nonCallable.diagnostics[0]?.message, 'Value of type Int is not callable');
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

async function loadMvpModule(): Promise<{ readonly root: string; readonly module: SelfhostMvpModule }> {
	const result = await buildProject(mvpRoot, { write: false });
	const errors = result.diagnostics.filter(item => item.severity === 'error');
	assert.deepEqual(errors.map(item => `${item.code}:${item.message}`), []);
	await mkdir(temporaryRoot, { recursive: true });
	const root = await mkdtemp(join(temporaryRoot, 'selfhost-member-chain-'));
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
	return {
		root,
		module: await import(`${pathToFileURL(join(root, 'main.js')).href}?test=${Date.now()}`) as SelfhostMvpModule,
	};
}
