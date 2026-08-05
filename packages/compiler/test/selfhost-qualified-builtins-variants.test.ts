import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildProject } from '../src/project/project.js';
import { snapshotProjectBuild } from '../src/selfhost/bootstrap-artifact-snapshot.js';
import {
	loadBootstrapCompilerCandidate,
	materializeBootstrapCompilerCandidate,
} from '../src/selfhost/bootstrap-execution-probe.js';
import { kernelInputFromProjectBuild } from '../src/selfhost/bootstrap-stage-runner.js';
import { compileWithProjectCompilerBoundary } from '../src/selfhost/project-compiler-adapter.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const mvpRoot = join(repositoryRoot, 'selfhost', 'mvp');
const temporaryRoot = join(repositoryRoot, '.test-tmp');
const snapshotOptions = {
	stage: 'stage0' as const,
	compilerVersion: '1.0.0',
	runtimeAbi: '1',
	interopAbi: '1',
	seedSha256: '8'.repeat(64),
};

test('generated compiler resolves required qualified builtins and enum variants', async () => {
	await mkdir(temporaryRoot, { recursive: true });
	const build = await buildProject(mvpRoot, { write: false });
	const errors = build.diagnostics.filter(item => item.severity === 'error');
	assert.deepEqual(errors.map(item => `${item.code}:${item.message}`), []);
	const artifact = snapshotProjectBuild(build, snapshotOptions);
	const root = await materializeBootstrapCompilerCandidate(artifact, temporaryRoot);
	try {
		const module = await loadBootstrapCompilerCandidate(root, 'dist/main.js');
		const input = kernelInputFromProjectBuild(build);
		const accepted = compileWithProjectCompilerBoundary(module, {
			...input,
			entryPath: 'src/main.virune',
			sources: [{
				path: 'src/main.virune',
				text: [
					'pub fn listResult() -> Int {',
					'\tlet values: List<Int> = [1, 2]',
					'\tlet expanded = List.append(values, 3)',
					'\tlet selected = match List.get(expanded, 0) {',
					'\t\tSome(value) => value',
					'\t\tNone => 0',
					'\t}',
					'\treturn selected + List.length(expanded) + String.length("x")',
					'}',
					'',
					'pub fn stringResult(value: String) -> Int {',
					'\tlet sliced = String.slice(value, 0, None)',
					'\tlet points = String.codePoints(sliced)',
					'\treturn String.length(sliced) + List.length(points)',
					'}',
					'',
					'pub fn remainingBuiltins(value: String, values: List<String>) -> Bool {',
					'\tlet combined = List.concat(values, ["z"])',
					'\tlet joined = String.join(combined, ",")',
					'\tlet tail = List.last(values)',
					'\tlet formatted = Debug.format(List.length(values))',
					'\treturn List.isEmpty(values) || List.isNotEmpty(combined) || String.contains(joined, value) || String.startsWith(joined, value) || match tail { Some(item) => String.contains(formatted, item), None => false }',
					'}',
					'',
					'pub fn commentKind() -> FrontendCommentKind {',
					'\treturn FrontendCommentKind.Ordinary',
					'}',
					'',
					'pub fn impossible() -> Int {',
					'\treturn panic("boom")',
					'}',
					'',
					'pub fn statementValue(spanValue: MvpSpan) -> MvpStatement {',
					'\treturn MvpStatement.LetValue("value", false, Some(MvpType.IntType), 0, spanValue)',
					'}',
					'',
					'pub fn hirStatementValue(spanValue: MvpSpan) -> MvpHirStatement {',
					'\treturn MvpHirStatement.HirLet("value", false, MvpType.IntType, 0, spanValue)',
					'}',
					'',
					'pub fn functionCount(moduleValue: MvpModule) -> Int {',
					'\treturn List.length(moduleValue.functions)',
					'}',
					'',
					'pub fn firstFunction(moduleValue: MvpModule) -> MvpFunction? {',
					'\treturn List.get(moduleValue.functions, 0)',
					'}',
					'',
					'pub fn tokenKind() -> MvpTokenKind {',
					'\treturn MvpTokenKind.EndOfFile',
					'}',
					'',
					'pub fn frontendTokenKind() -> FrontendTokenKind {',
					'\treturn FrontendTokenKind.EndOfFile',
					'}',
					'',
					'pub fn typeValue() -> MvpType {',
					'\treturn MvpType.ListType(MvpListElementType.IntElement)',
					'}',
					'',
				].join('\n'),
			}],
		});
		assert.equal(accepted.accepted, true, JSON.stringify(accepted.diagnostics, null, 2));
		assert.deepEqual(accepted.diagnostics, []);

		const rejected = compileWithProjectCompilerBoundary(module, {
			...input,
			entryPath: 'src/main.virune',
			sources: [{
				path: 'src/main.virune',
				text: 'pub fn invalid() -> Int {\n\treturn missing\n}\n',
			}],
		});
		assert.equal(rejected.accepted, false);
		assert.ok(rejected.diagnostics.some(item => item.code === 'L1010' && item.message.includes('missing')));
	} finally {
		await rm(root, { recursive: true, force: true });
		await rm(temporaryRoot, { recursive: true, force: true });
	}
});
