// Specification evidence is declared beside the repository-owned runner that executes it.
// Each annotation names an existing source test and case; scripts/verify-spec.mjs verifies
// that the test remains on the unit or integration execution path before accepting it.
// @virune-rule {"id":"collection.eq-hash","runner":"unit","file":"packages/runtime/test/runtime.test.ts","case":"Virune Map and Set use structural equality and nominal type identity","kind":"positive","platform":"common"}
// @virune-rule {"id":"documentation.declaration","runner":"unit","file":"packages/compiler/test/compiler.test.ts","case":"documentation comments are classified and attached to supported AST nodes","kind":"positive","platform":"common"}
// @virune-rule {"id":"documentation.diagnostics","runner":"unit","file":"packages/compiler/test/compiler.test.ts","case":"documentation diagnostics reject orphan, misplaced, unsupported, and duplicate groups","kind":"positive","platform":"common"}
// @virune-rule {"id":"documentation.kinds","runner":"unit","file":"packages/compiler/test/compiler.test.ts","case":"documentation comments are classified and attached to supported AST nodes","kind":"positive","platform":"common"}
// @virune-rule {"id":"documentation.markdown","runner":"unit","file":"packages/language-server/test/features.test.ts","case":"Hover escapes raw HTML outside fenced documentation code blocks","kind":"positive","platform":"common"}
// @virune-rule {"id":"documentation.module","runner":"unit","file":"packages/compiler/test/compiler.test.ts","case":"documentation diagnostics reject orphan, misplaced, unsupported, and duplicate groups","kind":"positive","platform":"common"}
// @virune-rule {"id":"documentation.normalization","runner":"unit","file":"packages/formatter/test/formatter.test.ts","case":"formatter normalizes and preserves documentation comment markers","kind":"positive","platform":"common"}
// @virune-rule {"id":"documentation.semantics","runner":"unit","file":"packages/compiler/test/compiler.test.ts","case":"ordinary comments break documentation association and documentation never changes emitted JavaScript","kind":"positive","platform":"common"}
// @virune-rule {"id":"entry.async","runner":"integration","file":"integration/cli-api.test.ts","case":"CLI run creates a task context for async main without user arguments","kind":"positive","platform":"common"}
// @virune-rule {"id":"entry.browser","runner":"integration","file":"integration/browser.test.ts","case":"browser target executes emitted ESM in Chromium","kind":"positive","platform":"browser"}
// @virune-rule {"id":"entry.diagnostic","runner":"integration","file":"integration/entry-point-invalid.test.ts","case":"CLI run reports invalid main signatures as user diagnostics","kind":"positive","platform":"common"}
// @virune-rule {"id":"entry.exit","runner":"integration","file":"integration/entry-point-runtime.test.ts","case":"CLI run accepts args and Result<Unit, E>, and converts panic to exit code 1 without an internal stack","kind":"positive","platform":"common"}
// @virune-rule {"id":"entry.main","runner":"integration","file":"integration/entry-point-invalid.test.ts","case":"CLI run reports invalid main signatures as user diagnostics","kind":"positive","platform":"common"}
// @virune-rule {"id":"entry.module","runner":"integration","file":"integration/entry-point-invalid.test.ts","case":"CLI run reports invalid main signatures as user diagnostics","kind":"positive","platform":"common"}
// @virune-rule {"id":"entry.non-generic","runner":"integration","file":"integration/entry-point-invalid.test.ts","case":"CLI run reports invalid main signatures as user diagnostics","kind":"positive","platform":"common"}
// @virune-rule {"id":"entry.parameters","runner":"integration","file":"integration/entry-point-runtime.test.ts","case":"CLI run accepts args and Result<Unit, E>, and converts panic to exit code 1 without an internal stack","kind":"positive","platform":"common"}
// @virune-rule {"id":"entry.return","runner":"integration","file":"integration/entry-point-runtime.test.ts","case":"CLI run accepts args and Result<Unit, E>, and converts panic to exit code 1 without an internal stack","kind":"positive","platform":"common"}
// @virune-rule {"id":"entry.run-only","runner":"integration","file":"integration/entry-point-invalid.test.ts","case":"CLI run reports invalid main signatures as user diagnostics","kind":"positive","platform":"common"}
// @virune-rule {"id":"eval.order","runner":"integration","file":"integration/project.test.ts","case":"build output is deterministic","kind":"positive","platform":"common"}
// @virune-rule {"id":"eval.panic","runner":"integration","file":"integration/project.test.ts","case":"generated defer aggregates the primary panic and every cleanup panic","kind":"positive","platform":"common"}
// @virune-rule {"id":"eval.return","runner":"unit","file":"packages/compiler/test/compiler.test.ts","case":"reference evaluator agrees with the pure language core","kind":"positive","platform":"common"}
// @virune-rule {"id":"ffi.bytes","runner":"unit","file":"packages/runtime/test/runtime.test.ts","case":"Bytes and MutableBytes support binary round-trips without aliasing","kind":"positive","platform":"common"}
// @virune-rule {"id":"ffi.export","runner":"integration","file":"integration/project.test.ts","case":"derived JSON decoder and encoder round-trip external data","kind":"positive","platform":"common"}
// @virune-rule {"id":"ffi.export","runner":"integration","file":"integration/project.test.ts","case":"public enums expose qualified variants across modules","kind":"positive","platform":"common"}
// @virune-rule {"id":"interop.abi-v1","runner":"unit","file":"packages/js-interop/test/adapter.test.ts","case":"adapter build emits ESM and versioned ABI metadata","kind":"positive","platform":"common"}
// @virune-rule {"id":"interop.abi-v1","runner":"unit","file":"packages/js-interop/test/adapter.test.ts","case":"adapter ABI rejects generics and callbacks","kind":"negative","platform":"common"}
// @virune-rule {"id":"interop.bridges","runner":"unit","file":"packages/js-interop/test/interop.test.ts","case":"compiler emits direct JavaScript import and checked primitive bridge","kind":"positive","platform":"common"}
// @virune-rule {"id":"interop.direct","runner":"unit","file":"packages/js-interop/test/usage-resolution.test.ts","case":"compiler routes JavaScript calls through whole-usage TypeScript resolution without expected-type backflow","kind":"positive","platform":"common"}
// @virune-rule {"id":"interop.direct","runner":"unit","file":"packages/js-interop/test/corpus-rejection.test.ts","case":"named imports from CommonJS packages are rejected conservatively","kind":"negative","platform":"node"}
// @virune-rule {"id":"interop.foreign-values","runner":"unit","file":"packages/js-interop/test/usage-resolution.test.ts","case":"resolves complete TypeScript call usages with literal, generic, rest, and fixed-session evidence","kind":"positive","platform":"common"}
// @virune-rule {"id":"interop.foreign-values","runner":"unit","file":"packages/js-interop/test/boundary.test.ts","case":"rejects JavaScript re-exports and foreign types in public Virune APIs","kind":"negative","platform":"common"}
// @virune-rule {"id":"lexical.comments","runner":"unit","file":"packages/compiler/test/compiler.test.ts","case":"documentation comments are classified and attached to supported AST nodes","kind":"positive","platform":"common"}
// @virune-rule {"id":"lexical.encoding","runner":"unit","file":"packages/compiler/test/compiler.test.ts","case":"compiler fuzz: parser and checker never throw for deterministic malformed input corpus","kind":"positive","platform":"common"}
// @virune-rule {"id":"module.cycle","runner":"integration","file":"integration/project.test.ts","case":"module cycles are rejected","kind":"positive","platform":"common"}
// @virune-rule {"id":"module.file","runner":"integration","file":"integration/project.test.ts","case":"buildProject emits an ES module and traceable source map","kind":"positive","platform":"common"}
// @virune-rule {"id":"module.import","runner":"integration","file":"integration/project.test.ts","case":"public imports re-export values and preserve original type identity","kind":"positive","platform":"common"}
// @virune-rule {"id":"module.package","runner":"integration","file":"integration/project.test.ts","case":"npm package subpaths use virune declarations for checking and JavaScript exports at runtime","kind":"positive","platform":"common"}
// @virune-rule {"id":"module.visibility","runner":"integration","file":"integration/project.test.ts","case":"public API cannot expose a private nominal type","kind":"positive","platform":"common"}
// @virune-rule {"id":"platform.browser-runtime","runner":"integration","file":"integration/browser.test.ts","case":"browser target executes emitted ESM in Chromium","kind":"positive","platform":"browser"}
// @virune-rule {"id":"runtime.eq-hash","runner":"unit","file":"packages/runtime/test/runtime.test.ts","case":"Virune Map and Set use structural equality and nominal type identity","kind":"positive","platform":"common"}
// @virune-rule {"id":"runtime.interop-descriptors-v2","runner":"unit","file":"packages/runtime/test/runtime.test.ts","case":"FFI optional property metadata distinguishes missing and omitted values","kind":"positive","platform":"common"}
// @virune-rule {"id":"runtime.interop-descriptors-v2","runner":"unit","file":"packages/runtime/test/runtime.test.ts","case":"JSON and FFI preserve Bytes, collection semantics, and nominal runtime type IDs","kind":"positive","platform":"common"}
// @virune-rule {"id":"runtime.native-representation","runner":"unit","file":"packages/runtime/test/runtime.test.ts","case":"FFI conversion handles Option and records","kind":"positive","platform":"common"}
// @virune-rule {"id":"runtime.native-representation","runner":"unit","file":"packages/runtime/test/runtime.test.ts","case":"JSON and FFI preserve Bytes, collection semantics, and nominal runtime type IDs","kind":"positive","platform":"common"}
// @virune-rule {"id":"task.parallel","runner":"unit","file":"packages/runtime/test/runtime.test.ts","case":"Task.parallel cancels siblings, waits for settlement, and reports the leftmost rejection","kind":"positive","platform":"common"}
// @virune-rule {"id":"task.race","runner":"unit","file":"packages/runtime/test/runtime.test.ts","case":"Task.race observes first settlement while Task.firstOk observes first fulfillment","kind":"positive","platform":"common"}
// @virune-rule {"id":"task.scope","runner":"unit","file":"packages/runtime/test/runtime.test.ts","case":"Task.mapParallel cancels siblings and waits for their cleanup","kind":"positive","platform":"common"}
// @virune-rule {"id":"task.timeout","runner":"unit","file":"packages/runtime/test/runtime.test.ts","case":"Task.timeout cancels and settles the child before returning","kind":"positive","platform":"common"}
// @virune-rule {"id":"type.nominal-identity","runner":"integration","file":"integration/project.test.ts","case":"same-named records from different modules remain nominally distinct","kind":"positive","platform":"common"}

import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const integrationOnly = process.argv.includes('--integration-only');
const excludeBrowser = process.argv.includes('--exclude-browser');
const excludeSelfhostInventory = process.argv.includes('--exclude-selfhost-inventory');
const failureOutputOnly = process.argv.includes('--failure-output-only');
const platformSmoke = process.argv.includes('--platform-smoke');
const unitConcurrencyArguments = process.argv.filter(item => item.startsWith('--unit-concurrency='));
if (unitConcurrencyArguments.length > 1) {
	console.error('Specify --unit-concurrency at most once.');
	process.exit(1);
}
const unitConcurrency = unitConcurrencyArguments[0]?.slice('--unit-concurrency='.length)
	?? (process.env.VIRUNE_CI_JOB === 'core-tests-ubuntu-node24' ? '2' : undefined);
const integrationGroups = [
	{ name: 'CLI workflow', files: ['integration/dist/cli.test.js'] },
	{ name: 'CLI API', files: ['integration/dist/cli-api.test.js'] },
	{ name: 'conformance expectation validation', files: ['integration/dist/conformance.test.js'] },
	{ name: 'entry-point diagnostics', files: ['integration/dist/entry-point-invalid.test.js'] },
	{ name: 'entry-point runtime', files: ['integration/dist/entry-point-runtime.test.js'] },
	{ name: 'project integration', files: ['integration/dist/project.test.js'] },
];
const platformGroups = integrationGroups.filter(group => group.name !== 'conformance expectation validation');
const groups = platformSmoke ? platformGroups : [
	...(!integrationOnly ? [
		{
			name: 'unit',
			command: [
				'scripts/run-unit-tests.mjs',
				...(failureOutputOnly ? ['--failure-output-only'] : []),
				...(excludeSelfhostInventory ? [
					'--exclude-file=packages/compiler/dist/test/selfhost-full-language-inventory.test.js',
				] : []),
				...(unitConcurrency !== undefined ? [`--concurrency=${unitConcurrency}`] : []),
			],
		},
		{
			name: 'self-host kernel model',
			command: ['packages/cli/dist/src/main.js', 'test', 'selfhost/kernel'],
			failureOutput: '.cache/selfhost-kernel-test-failure.log',
		},
		{
			name: 'self-host compiler MVP',
			command: ['packages/cli/dist/src/main.js', 'test', 'selfhost/mvp'],
			failureOutput: '.cache/selfhost-mvp-test-failure.log',
		},
		{ name: 'documentation layout policy', files: ['scripts/verify-documentation.test.mjs'] },
		{ name: 'documentation example policy', files: ['scripts/verify-documentation-examples.test.mjs'] },
		{ name: 'spec contract policy', files: ['scripts/verify-spec.test.mjs'] },
		{
			name: 'npm publication plan policy',
			files: [
				'scripts/verify-npm-publication-plan.test.mjs',
				'scripts/verify-npm-publication-license.test.mjs',
				'scripts/publish-npm-release.test.mjs',
			],
		},
		{
			name: 'npm package contents audit policy',
			files: [
				'scripts/npm-package-contents-policy.test.mjs',
				'scripts/verify-npm-package-contents.test.mjs',
				'scripts/verify-npm-release-candidate-contents.test.mjs',
			],
		},
		{
			name: 'npm package contents audit',
			command: ['scripts/verify-npm-package-contents.mjs'],
			failureOutput: '.cache/unit-test-failure.log',
		},
		{
			name: 'npm publication identity policy',
			files: [
				'scripts/verify-npm-publication-identity.test.mjs',
				'scripts/verify-npm-publication-identity-boundaries.test.mjs',
			],
		},
		{
			name: 'public npm Registry verification policy',
			files: [
				'scripts/verify-public-npm-registry.test.mjs',
				'scripts/verify-public-npm-registry-channel.test.mjs',
			],
		},
		{
			name: 'Self-host promotion observation contracts',
			files: [
				'scripts/assemble-selfhost-promotion-observation.test.mjs',
				'scripts/compare-selfhost-clean-bootstrap-evidence.test.mjs',
				'scripts/create-selfhost-promotion-subject.test.mjs',
				'scripts/create-selfhost-promotion-subject-dynamic-loading.test.mjs',
				'scripts/create-selfhost-promotion-package-surface.test.mjs',
				'scripts/run-selfhost-promotion-performance.test.mjs',
				'scripts/run-selfhost-promotion-quality.test.mjs',
				'scripts/selfhost-promotion-host-contract.test.mjs',
				'scripts/selfhost-promotion-observation-workflow.test.mjs',
				'scripts/selfhost-promotion-host-provenance.test.mjs',
			],
		},
		{ name: 'repository license policy', files: ['scripts/verify-repository-license-policy.test.mjs'] },
		{ name: 'release license artifact policy', files: ['scripts/verify-release-license-artifacts.test.mjs'] },
		{
			name: 'VS Code license packaging policy',
			files: [
				'scripts/vscode-third-party-licenses.test.mjs',
				'scripts/reviewed-repository-source.test.mjs',
			],
		},
		{
			name: 'documentation examples',
			command: ['scripts/verify-documentation-examples.mjs'],
			failureOutput: '.cache/unit-test-failure.log',
		},
	] : []),
	...integrationGroups,
	...(!excludeBrowser ? [{ name: 'browser runtime', files: ['integration/dist/browser.test.js'] }] : []),
];

for (const group of groups) {
	console.log(`\n=== ${group.name} ===`);
	const code = group.command === undefined ? await runNodeTest(group.files) : await runCommand(group.command, group.failureOutput);
	if (code !== 0) process.exit(code);
}

function runNodeTest(files) {
	const { NODE_TEST_CONTEXT: _ignored, ...env } = process.env;
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, ['--test', '--test-timeout=120000', ...files], {
			cwd: process.cwd(),
			env,
			stdio: 'inherit',
		});
		child.once('error', reject);
		child.once('exit', code => resolve(code ?? 1));
	});
}

function runCommand(argumentsList, failureOutput) {
	const { NODE_TEST_CONTEXT: _ignored, ...env } = process.env;
	return new Promise((resolve, reject) => {
		const capture = typeof failureOutput === 'string';
		const child = spawn(process.execPath, argumentsList, {
			cwd: process.cwd(),
			env,
			stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
		});
		let output = '';
		if (capture) {
			child.stdout.setEncoding('utf8');
			child.stderr.setEncoding('utf8');
			child.stdout.on('data', chunk => { output += chunk; process.stdout.write(chunk); });
			child.stderr.on('data', chunk => { output += chunk; process.stderr.write(chunk); });
		}
		child.once('error', reject);
		child.once('exit', async code => {
			const exitCode = code ?? 1;
			if (capture && exitCode !== 0) {
				await mkdir(dirname(failureOutput), { recursive: true });
				await writeFile(failureOutput, output);
			}
			resolve(exitCode);
		});
	});
}