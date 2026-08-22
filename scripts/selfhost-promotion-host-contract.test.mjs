import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { REQUIRED_SELFHOST_HOST_FILES } from './create-selfhost-promotion-subject.mjs';
import {
	hashBundledRuntimeClosure,
	hashRequiredSelfhostHostContract,
} from './selfhost-promotion-host-contract.mjs';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const compilerDist = join(repositoryRoot, 'packages', 'compiler', 'dist', 'src');

async function fixture() {
	const root = await mkdtemp(join(tmpdir(), 'virune-host-contract-'));
	return { root, async cleanup() { await rm(root, { recursive: true, force: true }); } };
}

test('current required-selfhost Host contract binds the real project-build runtime closure', async () => {
	const result = await hashRequiredSelfhostHostContract({
		repositoryRoot,
		compilerDist,
		files: REQUIRED_SELFHOST_HOST_FILES,
	});
	assert.equal(result.manifest.version, 3);
	assert.equal(result.manifest.projectBuildClosure?.claim, 'required-selfhost-host-project-build-v1');
	assert.ok(result.projectBuildClosure !== null);
	assert.deepEqual(result.manifest.dynamicLoading, [{
		importer: 'selfhost/bootstrap-execution-probe.js',
		warningId: 'unsupported-dynamic-import',
		count: 1,
		binding: 'generated:bootstrap-execution-candidate-v1',
	}, {
		importer: 'selfhost/bootstrap-stage-loader.js',
		warningId: 'unsupported-dynamic-import',
		count: 1,
		binding: 'generated:bootstrap-stage-compiler-candidate-v1',
	}]);
	const paths = result.projectBuildClosure.manifest.inputs.map(item => item.path);
	assert.ok(paths.includes('packages/compiler/dist/src/project/project.js'));
	assert.ok(paths.some(path => path.startsWith('node_modules/chevrotain/')), 'project-build closure must bind Chevrotain runtime bytes');
	assert.ok(paths.some(path => path.startsWith('node_modules/@jridgewell/gen-mapping/')), 'project-build closure must bind source-map runtime bytes');
	assert.equal(paths.some(path => path.startsWith('scripts/')), false, 'promotion tooling must not become self-referential product identity');
	assert.ok(result.manifest.imports.some(item => item.importer === 'selfhost/bootstrap-stage-runner.js' && item.binding === 'closure:project-build'));
	assert.ok(result.manifest.imports.some(item => item.importer === 'selfhost/bootstrap-execution-probe.js' && item.binding === 'closure:project-build'));
});

test('bundled runtime closure is deterministic and changes with local or package runtime bytes', async () => {
	const f = await fixture();
	try {
		await mkdir(join(f.root, 'dist'), { recursive: true });
		await mkdir(join(f.root, 'node_modules', 'fixture-package'), { recursive: true });
		await writeFile(join(f.root, 'dist', 'entry.js'), "import { local } from './helper.js';\nimport { external } from 'fixture-package';\nexport const value = local + external;\n", 'utf8');
		await writeFile(join(f.root, 'dist', 'helper.js'), 'export const local = 1;\n', 'utf8');
		await writeFile(join(f.root, 'node_modules', 'fixture-package', 'package.json'), JSON.stringify({ name: 'fixture-package', version: '1.0.0', type: 'module', exports: './index.js' }), 'utf8');
		await writeFile(join(f.root, 'node_modules', 'fixture-package', 'index.js'), 'export const external = 2;\n', 'utf8');
		const first = await hashBundledRuntimeClosure({ repositoryRoot: f.root, entryPoint: 'dist/entry.js', claim: 'fixture-runtime-v1' });
		const second = await hashBundledRuntimeClosure({ repositoryRoot: f.root, entryPoint: 'dist/entry.js', claim: 'fixture-runtime-v1' });
		assert.equal(first.sha256, second.sha256);
		assert.ok(first.manifest.inputs.some(item => item.path === 'node_modules/fixture-package/index.js'));
		await writeFile(join(f.root, 'dist', 'helper.js'), 'export const local = 3;\n', 'utf8');
		assert.notEqual((await hashBundledRuntimeClosure({ repositoryRoot: f.root, entryPoint: 'dist/entry.js', claim: 'fixture-runtime-v1' })).sha256, first.sha256);
		await writeFile(join(f.root, 'dist', 'helper.js'), 'export const local = 1;\n', 'utf8');
		await writeFile(join(f.root, 'node_modules', 'fixture-package', 'index.js'), 'export const external = 4;\n', 'utf8');
		assert.notEqual((await hashBundledRuntimeClosure({ repositoryRoot: f.root, entryPoint: 'dist/entry.js', claim: 'fixture-runtime-v1' })).sha256, first.sha256);
	} finally { await f.cleanup(); }
});

test('bundled runtime closure uses Node-like package conditions and main-field resolution', async () => {
	const f = await fixture();
	try {
		await mkdir(join(f.root, 'dist'), { recursive: true });
		await mkdir(join(f.root, 'node_modules', 'condition-package'), { recursive: true });
		await mkdir(join(f.root, 'node_modules', 'main-package'), { recursive: true });
		await writeFile(join(f.root, 'dist', 'entry.js'), "import { conditionValue } from 'condition-package';\nimport { mainValue } from 'main-package';\nexport const value = conditionValue + mainValue;\n", 'utf8');
		await writeFile(join(f.root, 'node_modules', 'condition-package', 'package.json'), JSON.stringify({
			name: 'condition-package',
			version: '1.0.0',
			type: 'module',
			exports: { '.': { module: './module.js', default: './default.js' } },
		}), 'utf8');
		await writeFile(join(f.root, 'node_modules', 'condition-package', 'module.js'), 'export const conditionValue = 100;\n', 'utf8');
		await writeFile(join(f.root, 'node_modules', 'condition-package', 'default.js'), 'export const conditionValue = 1;\n', 'utf8');
		await writeFile(join(f.root, 'node_modules', 'main-package', 'package.json'), JSON.stringify({
			name: 'main-package',
			version: '1.0.0',
			type: 'module',
			main: './main.js',
			module: './module.js',
		}), 'utf8');
		await writeFile(join(f.root, 'node_modules', 'main-package', 'main.js'), 'export const mainValue = 2;\n', 'utf8');
		await writeFile(join(f.root, 'node_modules', 'main-package', 'module.js'), 'export const mainValue = 200;\n', 'utf8');
		const result = await hashBundledRuntimeClosure({ repositoryRoot: f.root, entryPoint: 'dist/entry.js', claim: 'fixture-node-resolution-v1' });
		const paths = result.manifest.inputs.map(item => item.path);
		assert.ok(paths.includes('node_modules/condition-package/default.js'));
		assert.equal(paths.includes('node_modules/condition-package/module.js'), false);
		assert.ok(paths.includes('node_modules/main-package/main.js'));
		assert.equal(paths.includes('node_modules/main-package/module.js'), false);
	} finally { await f.cleanup(); }
});

test('bundled runtime closure keeps bare imports even when package sideEffects metadata says false', async () => {
	const f = await fixture();
	try {
		await mkdir(join(f.root, 'dist'), { recursive: true });
		await mkdir(join(f.root, 'node_modules', 'side-effect-package'), { recursive: true });
		await writeFile(join(f.root, 'dist', 'entry.js'), "import 'side-effect-package';\nexport const value = 1;\n", 'utf8');
		await writeFile(join(f.root, 'node_modules', 'side-effect-package', 'package.json'), JSON.stringify({
			name: 'side-effect-package', version: '1.0.0', type: 'module', exports: './index.js', sideEffects: false,
		}), 'utf8');
		await writeFile(join(f.root, 'node_modules', 'side-effect-package', 'index.js'), 'globalThis.__fixtureSideEffect = true;\n', 'utf8');
		const result = await hashBundledRuntimeClosure({ repositoryRoot: f.root, entryPoint: 'dist/entry.js', claim: 'fixture-side-effects-v1' });
		assert.ok(result.manifest.inputs.some(item => item.path === 'node_modules/side-effect-package/index.js'));
	} finally { await f.cleanup(); }
});

test('bundled runtime closure rejects non-analyzable dynamic import and require calls', async () => {
	const f = await fixture();
	try {
		await mkdir(join(f.root, 'dist'), { recursive: true });
		await writeFile(join(f.root, 'package.json'), JSON.stringify({ type: 'module' }), 'utf8');
		await writeFile(join(f.root, 'dist', 'helper.js'), 'export const helper = 1;\n', 'utf8');
		await writeFile(join(f.root, 'dist', 'entry.js'), "const target = './helper.js';\nexport async function load() { return import(target); }\n", 'utf8');
		await assert.rejects(
			() => hashBundledRuntimeClosure({ repositoryRoot: f.root, entryPoint: 'dist/entry.js', claim: 'fixture-dynamic-import-v1' }),
			/non-analyzable module loading: unsupported-dynamic-import/u,
		);
		await writeFile(join(f.root, 'dist', 'entry.js'), "const target = './helper.js';\nexport function load() { return require(target); }\n", 'utf8');
		await assert.rejects(
			() => hashBundledRuntimeClosure({ repositoryRoot: f.root, entryPoint: 'dist/entry.js', claim: 'fixture-dynamic-require-v1' }),
			/non-analyzable module loading: unsupported-require-call/u,
		);
	} finally { await f.cleanup(); }
});

test('bundled runtime closure rejects CommonJS inputs even when require paths are statically analyzable', async () => {
	const f = await fixture();
	try {
		await mkdir(join(f.root, 'dist'), { recursive: true });
		await writeFile(join(f.root, 'dist', 'entry.cjs'), "module.exports = require('./helper.cjs');\n", 'utf8');
		await writeFile(join(f.root, 'dist', 'helper.cjs'), 'module.exports = 1;\n', 'utf8');
		await assert.rejects(
			() => hashBundledRuntimeClosure({ repositoryRoot: f.root, entryPoint: 'dist/entry.cjs', claim: 'fixture-commonjs-v1' }),
			/CommonJS; require closure must be modeled explicitly/u,
		);
	} finally { await f.cleanup(); }
});

test('Host boundary rejects a newly introduced unbound relative or package import', async () => {
	const f = await fixture();
	try {
		const base = join(f.root, 'dist');
		await mkdir(join(base, 'selfhost'), { recursive: true });
		await writeFile(join(base, 'selfhost', 'root.js'), "import './hidden.js';\nexport const root = true;\n", 'utf8');
		await writeFile(join(base, 'selfhost', 'hidden.js'), 'export const hidden = true;\n', 'utf8');
		await assert.rejects(
			() => hashRequiredSelfhostHostContract({ repositoryRoot: f.root, compilerDist: base, files: ['selfhost/root.js'], claim: 'fixture-host-v3' }),
			/unbound relative runtime import/u,
		);
		await writeFile(join(base, 'selfhost', 'root.js'), "import 'unbound-package';\nexport const root = true;\n", 'utf8');
		await assert.rejects(
			() => hashRequiredSelfhostHostContract({ repositoryRoot: f.root, compilerDist: base, files: ['selfhost/root.js'], claim: 'fixture-host-v3' }),
			/unbound external runtime import unbound-package/u,
		);
	} finally { await f.cleanup(); }
});

test('Host boundary rejects non-analyzable dynamic module loading before it can escape the fixed contract', async () => {
	const f = await fixture();
	try {
		const base = join(f.root, 'dist');
		await mkdir(join(base, 'selfhost'), { recursive: true });
		await writeFile(join(base, 'selfhost', 'root.js'), "const target = './hidden.js';\nexport async function load() { return import(target); }\n", 'utf8');
		await assert.rejects(
			() => hashRequiredSelfhostHostContract({ repositoryRoot: f.root, compilerDist: base, files: ['selfhost/root.js'], claim: 'fixture-host-v3' }),
			/Host module selfhost\/root\.js contains non-analyzable module loading: unsupported-dynamic-import/u,
		);
		await writeFile(join(base, 'selfhost', 'root.js'), "const target = './hidden.js';\nexport function load() { return require(target); }\n", 'utf8');
		await assert.rejects(
			() => hashRequiredSelfhostHostContract({ repositoryRoot: f.root, compilerDist: base, files: ['selfhost/root.js'], claim: 'fixture-host-v3' }),
			/Host module selfhost\/root\.js contains non-analyzable module loading: unsupported-require-call/u,
		);
	} finally { await f.cleanup(); }
});

test('Host project-build import is bound transitively without absorbing unrelated files', async () => {
	const f = await fixture();
	try {
		const base = join(f.root, 'dist');
		await mkdir(join(base, 'selfhost'), { recursive: true });
		await mkdir(join(base, 'project'), { recursive: true });
		await writeFile(join(base, 'selfhost', 'root.js'), "import { build } from '../project/project.js';\nexport const run = build;\n", 'utf8');
		await writeFile(join(base, 'project', 'project.js'), "import { helper } from './helper.js';\nexport const build = () => helper;\n", 'utf8');
		await writeFile(join(base, 'project', 'helper.js'), 'export const helper = 1;\n', 'utf8');
		await writeFile(join(base, 'unrelated.js'), 'export const unrelated = 1;\n', 'utf8');
		const first = await hashRequiredSelfhostHostContract({ repositoryRoot: f.root, compilerDist: base, files: ['selfhost/root.js'], claim: 'fixture-host-v3' });
		assert.ok(first.projectBuildClosure !== null);
		assert.equal(first.projectBuildClosure.manifest.inputs.some(item => item.path.endsWith('/unrelated.js') || item.path === 'dist/unrelated.js'), false);
		await writeFile(join(base, 'project', 'helper.js'), 'export const helper = 2;\n', 'utf8');
		assert.notEqual((await hashRequiredSelfhostHostContract({ repositoryRoot: f.root, compilerDist: base, files: ['selfhost/root.js'], claim: 'fixture-host-v3' })).sha256, first.sha256);
		await writeFile(join(base, 'project', 'helper.js'), 'export const helper = 1;\n', 'utf8');
		await writeFile(join(base, 'unrelated.js'), 'export const unrelated = 2;\n', 'utf8');
		assert.equal((await hashRequiredSelfhostHostContract({ repositoryRoot: f.root, compilerDist: base, files: ['selfhost/root.js'], claim: 'fixture-host-v3' })).sha256, first.sha256);
	} finally { await f.cleanup(); }
});

test('Legacy exclusion is allowed only for the exact lazy boundary', async () => {
	const f = await fixture();
	try {
		const base = join(f.root, 'dist');
		await mkdir(join(base, 'selfhost'), { recursive: true });
		await writeFile(join(base, 'selfhost', 'legacy-adapter.js'), 'export const legacy = true;\n', 'utf8');
		await writeFile(join(base, 'selfhost', 'mvp-adapter.js'), "export async function load() { return import('./legacy-adapter.js'); }\n", 'utf8');
		const lazy = await hashRequiredSelfhostHostContract({ repositoryRoot: f.root, compilerDist: base, files: ['selfhost/mvp-adapter.js'], claim: 'fixture-host-v3' });
		assert.ok(lazy.manifest.imports.some(item => item.binding === 'excluded:lazy-legacy'));
		await writeFile(join(base, 'selfhost', 'mvp-adapter.js'), "import './legacy-adapter.js';\nexport const load = true;\n", 'utf8');
		await assert.rejects(
			() => hashRequiredSelfhostHostContract({ repositoryRoot: f.root, compilerDist: base, files: ['selfhost/mvp-adapter.js'], claim: 'fixture-host-v3' }),
			/versioned lazy import boundary/u,
		);
	} finally { await f.cleanup(); }
});

test('bundled runtime closure rejects symlink traversal instead of hashing the resolved target silently', async () => {
	const f = await fixture();
	try {
		await mkdir(join(f.root, 'dist'), { recursive: true });
		await mkdir(join(f.root, 'real'), { recursive: true });
		await writeFile(join(f.root, 'dist', 'entry.js'), "export { value } from './linked/value.js';\n", 'utf8');
		await writeFile(join(f.root, 'real', 'value.js'), 'export const value = 1;\n', 'utf8');
		await symlink(join(f.root, 'real'), join(f.root, 'dist', 'linked'), 'dir');
		await assert.rejects(
			() => hashBundledRuntimeClosure({ repositoryRoot: f.root, entryPoint: 'dist/entry.js', claim: 'fixture-runtime-v1' }),
			/symlink path component/u,
		);
	} finally { await f.cleanup(); }
});

test('helper source itself remains readable for repository policy checks', async () => {
	const source = await readFile(new URL('./selfhost-promotion-host-contract.mjs', import.meta.url), 'utf8');
	assert.match(source, /required-selfhost-host-execution-contract-v3/u);
	assert.match(source, /generated:bootstrap-execution-candidate-v1/u);
	assert.match(source, /generated:bootstrap-stage-compiler-candidate-v1/u);
	assert.match(source, /expectedNormalizedSourceSha256/u);
	assert.match(source, /unsupported-dynamic-import/u);
	assert.match(source, /unsupported-require-call/u);
	assert.match(source, /mainFields: \['main'\]/u);
	assert.match(source, /ignoreAnnotations: true/u);
});
