import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
	createRequiredSelfhostPromotionSubject,
	REQUIRED_SELFHOST_HOST_FILES,
	hashArtifactTree,
	hashFixedModuleSet,
	hashPackageProductSurface,
	hashRelativeModuleClosure,
	relativeModuleSpecifiers,
} from './create-selfhost-promotion-subject.mjs';

function digest(value) {
	return createHash('sha256').update(value).digest('hex');
}

async function fixture() {
	const root = await mkdtemp(join(tmpdir(), 'virune-promotion-subject-'));
	return { root, async cleanup() { await rm(root, { recursive: true, force: true }); } };
}

function canonicalReleaseCore(seedArtifactSha256, stage3Sha256) {
	const step = id => ({
		id,
		exitCode: 0,
		stdoutSha256: digest(`stdout:${id}`),
		stderrSha256: digest(`stderr:${id}`),
		status: 'pass',
		passed: true,
		evidenceSha256: digest(`evidence:${id}`),
	});
	const record = {
		schemaVersion: 2,
		claim: 'selfhost-stable-release-gate-core',
		productionEligible: false,
		checkedAt: '2026-08-22T00:00:00.000Z',
		policy: {
			version: 1,
			failClosed: true,
			requiredSteps: ['seed-verify', 'fixed-seed-bootstrap', 'clean-bootstrap', 'legacy-rollback'],
			fixedPoint: { from: 'stage2', to: 'stage3', requireEquivalent: true, requireShaEquality: true, differenceCount: 0 },
			cleanBootstrap: { dependencyMode: 'offline' },
			evidenceConsistency: { required: true },
			productionDefaultChange: false,
		},
		steps: ['seed-verify', 'fixed-seed-bootstrap', 'clean-bootstrap', 'legacy-rollback'].map(step),
		evidenceConsistency: {
			checked: true,
			passed: true,
			bindings: {
				seedArtifactSha256,
				seedManifestSha256: digest('seed-manifest'),
				stage1Sha256: digest('stage1'),
				stage2Sha256: stage3Sha256,
				stage3Sha256,
			},
		},
		passed: true,
	};
	return { ...record, evidenceSha256: digest(JSON.stringify(record)) };
}

async function writeSubjectFixture(root, { seedArtifactSha256, stage3Sha256, runtimeAbi = '2' }) {
	await mkdir(join(root, '.cache', 'selfhost-promotion-observation'), { recursive: true });
	await mkdir(join(root, '.github', 'self-hosting'), { recursive: true });
	await mkdir(join(root, 'packages', 'compiler', 'dist', 'src', 'selfhost'), { recursive: true });
	await mkdir(join(root, 'packages', 'compiler', 'dist', 'src', 'codegen'), { recursive: true });
	await mkdir(join(root, 'packages', 'runtime', 'dist', 'src'), { recursive: true });
	await mkdir(join(root, 'packages', 'stdlib', 'dist', 'src'), { recursive: true });
	await writeFile(
		join(root, '.cache', 'selfhost-promotion-observation', 'release-core.json'),
		JSON.stringify(canonicalReleaseCore(seedArtifactSha256, stage3Sha256)),
		'utf8',
	);
	await writeFile(
		join(root, '.github', 'self-hosting', 'stage0-seed.json'),
		JSON.stringify({ artifact: { sha256: seedArtifactSha256 }, baselines: { runtimeAbi } }),
		'utf8',
	);
	const compilerDist = join(root, 'packages', 'compiler', 'dist', 'src');
	await writeFile(
		join(compilerDist, 'selfhost', 'promotion-subject.js'),
		await readFile(new URL('../packages/compiler/dist/src/selfhost/promotion-subject.js', import.meta.url), 'utf8'),
		'utf8',
	);
	await writeFile(join(compilerDist, 'selfhost', 'bootstrap-artifact-normalizer.js'), 'export const policy = 1;\n', 'utf8');
	for (const relativePath of REQUIRED_SELFHOST_HOST_FILES) {
		const target = join(compilerDist, ...relativePath.split('/'));
		await mkdir(join(target, '..'), { recursive: true });
		await writeFile(target, `export const marker = ${JSON.stringify(relativePath)};\n`, 'utf8');
	}
	for (const relativePath of [
		'selfhost/bootstrap-execution-probe.js',
		'selfhost/bootstrap-stage-loader.js',
	]) {
		await writeFile(
			join(compilerDist, ...relativePath.split('/')),
			await readFile(new URL(`../packages/compiler/dist/src/${relativePath}`, import.meta.url), 'utf8'),
			'utf8',
		);
	}
	await mkdir(join(compilerDist, 'project'), { recursive: true });
	await writeFile(join(compilerDist, 'project', 'project.js'), "import { helper } from './fixture-helper.js';\nexport const buildProject = () => helper;\n", 'utf8');
	await writeFile(join(compilerDist, 'project', 'fixture-helper.js'), 'export const helper = 1;\n', 'utf8');
	await writeFile(join(compilerDist, 'selfhost', 'bootstrap-stage-runner.js'), "import { buildProject } from '../project/project.js';\nexport const marker = buildProject;\n", 'utf8');
	for (const [packageName, dependency] of [['runtime', {}], ['stdlib', { '@virune/runtime': '1.0.0' }]]) {
		const packageRoot = join(root, 'packages', packageName);
		await writeFile(join(packageRoot, 'package.json'), JSON.stringify({
			name: `@virune/${packageName}`,
			version: '1.0.0',
			type: 'module',
			engines: { node: '>=24.0.0' },
			exports: { '.': './dist/src/index.js' },
			dependencies: dependency,
		}), 'utf8');
		await writeFile(join(packageRoot, 'dist', 'src', 'index.js'), `export const ${packageName} = 1;\n`, 'utf8');
	}
}

async function writeReleaseCore(root, seedArtifactSha256, stage3Sha256) {
	await writeFile(
		join(root, '.cache', 'selfhost-promotion-observation', 'release-core.json'),
		JSON.stringify(canonicalReleaseCore(seedArtifactSha256, stage3Sha256)),
		'utf8',
	);
}

async function writeSeedManifest(root, seedArtifactSha256, runtimeAbi) {
	await writeFile(
		join(root, '.github', 'self-hosting', 'stage0-seed.json'),
		JSON.stringify({ artifact: { sha256: seedArtifactSha256 }, baselines: { runtimeAbi } }),
		'utf8',
	);
}

test('required-selfhost subject identity changes for every product boundary but ignores docs and governance noise', async () => {
	const f = await fixture();
	const seed = digest('seed-v1');
	const stage3 = digest('stage3-v1');
	try {
		await writeSubjectFixture(f.root, { seedArtifactSha256: seed, stage3Sha256: stage3 });
		const baseline = await createRequiredSelfhostPromotionSubject({ repositoryRoot: f.root });
		const baselineId = baseline.report.promotionSubjectId;

		await mkdir(join(f.root, 'docs'), { recursive: true });
		await writeFile(join(f.root, 'docs', 'governance-note.md'), 'metadata only\n', 'utf8');
		assert.equal((await createRequiredSelfhostPromotionSubject({ repositoryRoot: f.root })).report.promotionSubjectId, baselineId);

		const compilerDist = join(f.root, 'packages', 'compiler', 'dist', 'src');
		const normalizer = join(compilerDist, 'selfhost', 'bootstrap-artifact-normalizer.js');
		await writeFile(normalizer, 'export const policy = 2;\n', 'utf8');
		assert.notEqual((await createRequiredSelfhostPromotionSubject({ repositoryRoot: f.root })).report.promotionSubjectId, baselineId);
		await writeFile(normalizer, 'export const policy = 1;\n', 'utf8');

		const changedSeed = digest('seed-v2');
		await writeSeedManifest(f.root, changedSeed, '2');
		await writeReleaseCore(f.root, changedSeed, stage3);
		assert.notEqual((await createRequiredSelfhostPromotionSubject({ repositoryRoot: f.root })).report.promotionSubjectId, baselineId);
		await writeSeedManifest(f.root, seed, '2');
		await writeReleaseCore(f.root, seed, stage3);

		const changedStage3 = digest('stage3-v2');
		await writeReleaseCore(f.root, seed, changedStage3);
		assert.notEqual((await createRequiredSelfhostPromotionSubject({ repositoryRoot: f.root })).report.promotionSubjectId, baselineId);
		await writeReleaseCore(f.root, seed, stage3);

		const hostFile = join(compilerDist, ...REQUIRED_SELFHOST_HOST_FILES[0].split('/'));
		const originalHost = `export const marker = ${JSON.stringify(REQUIRED_SELFHOST_HOST_FILES[0])};\n`;
		await writeFile(hostFile, 'export const marker = "changed-host";\n', 'utf8');
		assert.notEqual((await createRequiredSelfhostPromotionSubject({ repositoryRoot: f.root })).report.promotionSubjectId, baselineId);
		await writeFile(hostFile, originalHost, 'utf8');

		const projectHelper = join(compilerDist, 'project', 'fixture-helper.js');
		await writeFile(projectHelper, 'export const helper = 2;\n', 'utf8');
		assert.notEqual((await createRequiredSelfhostPromotionSubject({ repositoryRoot: f.root })).report.promotionSubjectId, baselineId);
		await writeFile(projectHelper, 'export const helper = 1;\n', 'utf8');

		const runtimeArtifact = join(f.root, 'packages', 'runtime', 'dist', 'src', 'index.js');
		await writeFile(runtimeArtifact, 'export const runtime = 2;\n', 'utf8');
		assert.notEqual((await createRequiredSelfhostPromotionSubject({ repositoryRoot: f.root })).report.promotionSubjectId, baselineId);
		await writeFile(runtimeArtifact, 'export const runtime = 1;\n', 'utf8');

		await writeSeedManifest(f.root, seed, '3');
		assert.notEqual((await createRequiredSelfhostPromotionSubject({ repositoryRoot: f.root })).report.promotionSubjectId, baselineId);
		await writeSeedManifest(f.root, seed, '2');

		const stdlibArtifact = join(f.root, 'packages', 'stdlib', 'dist', 'src', 'index.js');
		await writeFile(stdlibArtifact, 'export const stdlib = 2;\n', 'utf8');
		assert.notEqual((await createRequiredSelfhostPromotionSubject({ repositoryRoot: f.root })).report.promotionSubjectId, baselineId);
	} finally { await f.cleanup(); }
});

test('artifact tree identity is deterministic and changes with product bytes, not directory enumeration order', async () => {
	const f = await fixture();
	try {
		await mkdir(join(f.root, 'nested'), { recursive: true });
		await writeFile(join(f.root, 'z.js'), 'z', 'utf8');
		await writeFile(join(f.root, 'nested', 'a.js'), 'a', 'utf8');
		const first = await hashArtifactTree(f.root, 'fixture-v1');
		const second = await hashArtifactTree(f.root, 'fixture-v1');
		assert.equal(first.sha256, second.sha256);
		assert.deepEqual(first.manifest.files.map(item => item.path), ['nested/a.js', 'z.js']);
		await writeFile(join(f.root, 'nested', 'a.js'), 'changed', 'utf8');
		assert.notEqual((await hashArtifactTree(f.root, 'fixture-v1')).sha256, first.sha256);
	} finally { await f.cleanup(); }
});

test('package product surface binds executable exports, engines, dependencies, and built artifact without metadata noise', async () => {
	const f = await fixture();
	try {
		await mkdir(join(f.root, 'dist', 'src'), { recursive: true });
		await writeFile(join(f.root, 'dist', 'src', 'index.js'), 'export const value = 1;\n', 'utf8');
		await writeFile(join(f.root, 'dist', 'src', 'other.js'), 'export const other = 1;\n', 'utf8');
		const packageManifest = {
			name: '@virune/fixture',
			version: '1.0.0',
			type: 'module',
			engines: { node: '>=24.0.0' },
			exports: { '.': './dist/src/index.js' },
			dependencies: { '@virune/runtime': '1.0.0' },
			description: 'metadata only',
			keywords: ['ignored'],
		};
		await writeFile(join(f.root, 'package.json'), JSON.stringify(packageManifest), 'utf8');
		const first = await hashPackageProductSurface({ packageRoot: f.root, claim: 'fixture-product-v1' });
		await writeFile(join(f.root, 'package.json'), JSON.stringify({ ...packageManifest, description: 'changed metadata', keywords: ['also ignored'] }), 'utf8');
		assert.equal((await hashPackageProductSurface({ packageRoot: f.root, claim: 'fixture-product-v1' })).sha256, first.sha256);
		await writeFile(join(f.root, 'package.json'), JSON.stringify({ ...packageManifest, exports: { '.': './dist/src/other.js' } }), 'utf8');
		assert.notEqual((await hashPackageProductSurface({ packageRoot: f.root, claim: 'fixture-product-v1' })).sha256, first.sha256);
		await writeFile(join(f.root, 'package.json'), JSON.stringify({ ...packageManifest, dependencies: { '@virune/runtime': '2.0.0' } }), 'utf8');
		assert.notEqual((await hashPackageProductSurface({ packageRoot: f.root, claim: 'fixture-product-v1' })).sha256, first.sha256);
		await writeFile(join(f.root, 'package.json'), JSON.stringify(packageManifest), 'utf8');
		await writeFile(join(f.root, 'dist', 'src', 'index.js'), 'export const value = 2;\n', 'utf8');
		assert.notEqual((await hashPackageProductSurface({ packageRoot: f.root, claim: 'fixture-product-v1' })).sha256, first.sha256);
	} finally { await f.cleanup(); }
});

test('package product surface rejects a symlinked parent directory in the built artifact path', async () => {
	const f = await fixture();
	try {
		const packageRoot = join(f.root, 'package');
		const externalDist = join(f.root, 'external-dist');
		await mkdir(packageRoot, { recursive: true });
		await mkdir(join(externalDist, 'src'), { recursive: true });
		await writeFile(join(externalDist, 'src', 'index.js'), 'export const escaped = true;\n', 'utf8');
		await writeFile(join(packageRoot, 'package.json'), JSON.stringify({
			name: '@virune/fixture', version: '1.0.0', type: 'module',
			engines: { node: '>=24.0.0' }, exports: { '.': './dist/src/index.js' }, dependencies: {},
		}), 'utf8');
		await symlink(externalDist, join(packageRoot, 'dist'), 'dir');
		await assert.rejects(
			() => hashPackageProductSurface({ packageRoot, claim: 'fixture-product-v1' }),
			/symlink path component/u,
		);
	} finally { await f.cleanup(); }
});

test('required Self-host Host boundary explicitly binds semantic execution and selection dependencies', () => {
	assert.deepEqual(REQUIRED_SELFHOST_HOST_FILES, [
		'codegen/helpers.js',
		'codegen/runtime-imports.js',
		'selfhost/bootstrap-artifact-snapshot.js',
		'selfhost/bootstrap-compiler-selection.js',
		'selfhost/bootstrap-execution-probe.js',
		'selfhost/bootstrap-rollback-decision.js',
		'selfhost/bootstrap-stage-executor.js',
		'selfhost/bootstrap-stage-loader.js',
		'selfhost/bootstrap-stage-pipeline.js',
		'selfhost/bootstrap-stage-runner.js',
		'selfhost/compiler-facade.js',
		'selfhost/contract.js',
		'selfhost/legacy-adapter.js',
		'selfhost/mvp-adapter.js',
		'selfhost/project-compiler-adapter.js',
		'selfhost/source-manifest.js',
		'selfhost/stage-compiler-facade.js',
	]);
	assert.equal(REQUIRED_SELFHOST_HOST_FILES.includes('selfhost/legacy-adapter.js'), true);
});

test('current Self-host MVP static Legacy dependency is conservatively bound into the Host product closure', async () => {
	const source = await readFile(new URL('../packages/compiler/dist/src/selfhost/mvp-adapter.js', import.meta.url), 'utf8');
	assert.match(source, /from ['"]\.\/legacy-adapter\.js['"]/u);
	assert.doesNotMatch(source, /import\(['"]\.\/legacy-adapter\.js['"]\)/u);
});

test('fixed Host contract hashes exactly the versioned boundary file set', async () => {
	const f = await fixture();
	try {
		await mkdir(join(f.root, 'selfhost'), { recursive: true });
		await writeFile(join(f.root, 'selfhost', 'selection.js'), "import './legacy-implementation.js';\nexport const selection = 'legacy';\n", 'utf8');
		await writeFile(join(f.root, 'selfhost', 'stage-loader.js'), "export const load = 'stage';\n", 'utf8');
		await writeFile(join(f.root, 'selfhost', 'legacy-implementation.js'), "export const implementation = 1;\n", 'utf8');
		const files = ['selfhost/stage-loader.js', 'selfhost/selection.js'];
		const first = await hashFixedModuleSet({ baseDirectory: f.root, files, claim: 'fixture-host-v1' });
		assert.deepEqual(first.manifest.files.map(item => item.path), ['selfhost/selection.js', 'selfhost/stage-loader.js']);
		await writeFile(join(f.root, 'selfhost', 'legacy-implementation.js'), "export const implementation = 2;\n", 'utf8');
		assert.equal((await hashFixedModuleSet({ baseDirectory: f.root, files, claim: 'fixture-host-v1' })).sha256, first.sha256);
		await writeFile(join(f.root, 'selfhost', 'stage-loader.js'), "export const load = 'changed';\n", 'utf8');
		assert.notEqual((await hashFixedModuleSet({ baseDirectory: f.root, files, claim: 'fixture-host-v1' })).sha256, first.sha256);
	} finally { await f.cleanup(); }
});

test('fixed Host contract fails closed on duplicate, missing, or symlink boundary entries', async () => {
	const f = await fixture();
	try {
		await mkdir(join(f.root, 'selfhost'), { recursive: true });
		await writeFile(join(f.root, 'selfhost', 'real.js'), 'export const x = 1;\n', 'utf8');
		await assert.rejects(
			() => hashFixedModuleSet({ baseDirectory: f.root, files: ['selfhost/real.js', 'selfhost/real.js'], claim: 'fixture-host-v1' }),
			/duplicate module paths/u,
		);
		await assert.rejects(
			() => hashFixedModuleSet({ baseDirectory: f.root, files: ['selfhost/missing.js'], claim: 'fixture-host-v1' }),
			/ENOENT/u,
		);
		await symlink(join(f.root, 'selfhost', 'real.js'), join(f.root, 'selfhost', 'link.js'));
		await assert.rejects(
			() => hashFixedModuleSet({ baseDirectory: f.root, files: ['selfhost/link.js'], claim: 'fixture-host-v1' }),
			/symlink path component/u,
		);
	} finally { await f.cleanup(); }
});

test('fixed Host contract rejects a symlinked parent directory before reading a boundary file', async () => {
	const f = await fixture();
	try {
		const external = join(f.root, 'external');
		await mkdir(join(f.root, 'selfhost'), { recursive: true });
		await mkdir(external, { recursive: true });
		await writeFile(join(external, 'escaped.js'), 'export const escaped = true;\n', 'utf8');
		await symlink(external, join(f.root, 'selfhost', 'linked'), 'dir');
		await assert.rejects(
			() => hashFixedModuleSet({ baseDirectory: f.root, files: ['selfhost/linked/escaped.js'], claim: 'fixture-host-v1' }),
			/symlink path component/u,
		);
	} finally { await f.cleanup(); }
});

test('bootstrap policy closure follows from, dynamic, re-export, and side-effect relative imports transitively', async () => {
	const f = await fixture();
	try {
		await mkdir(join(f.root, 'selfhost'), { recursive: true });
		await writeFile(join(f.root, 'selfhost', 'root.js'), [
			"import './side.js';",
			"import { value } from './from.js';",
			"export { other } from './exported.js';",
			"export async function load() { return import('./dynamic.js'); }",
			'export { value };',
		].join('\n'), 'utf8');
		await writeFile(join(f.root, 'selfhost', 'side.js'), "import './deep.js';\n", 'utf8');
		for (const name of ['from.js', 'exported.js', 'dynamic.js', 'deep.js']) await writeFile(join(f.root, 'selfhost', name), `export const x = '${name}';\n`, 'utf8');
		const result = await hashRelativeModuleClosure({ baseDirectory: f.root, roots: ['selfhost/root.js'], claim: 'fixture-bootstrap-policy-v1' });
		assert.deepEqual(result.manifest.files.map(item => item.path), [
			'selfhost/deep.js', 'selfhost/dynamic.js', 'selfhost/exported.js', 'selfhost/from.js', 'selfhost/root.js', 'selfhost/side.js',
		]);
	} finally { await f.cleanup(); }
});

test('bootstrap policy import parser ignores lexical lookalikes, allows Node builtins, and rejects unbound imports or malformed JavaScript', async () => {
	const source = [
		"// import './comment.js';",
		"const text = \"export { x } from './string.js'\";",
		"import './side.js';",
		"import { value } from './from.js';",
		"export { other } from './exported.js';",
		"export async function load() { return import('./dynamic.js'); }",
		"import 'node:path';",
	].join('\n');
	assert.deepEqual(await relativeModuleSpecifiers(source, 'fixture.js'), [
		'./dynamic.js', './exported.js', './from.js', './side.js',
	]);
	await assert.rejects(
		() => relativeModuleSpecifiers("import 'external-package';", 'external.js'),
		/compiled Host module external\.js has unsupported external imports: external-package/u,
	);
	await assert.rejects(
		() => relativeModuleSpecifiers('export const broken = ;', 'broken.js'),
		/compiled Host module broken\.js is not valid JavaScript/u,
	);
});

test('module closure rejects imports that escape the configured artifact root', async () => {
	const f = await fixture();
	try {
		await mkdir(join(f.root, 'base'), { recursive: true });
		await writeFile(join(f.root, 'base', 'root.js'), "export { x } from '../outside.js';\n", 'utf8');
		await writeFile(join(f.root, 'outside.js'), 'export const x = 1;\n', 'utf8');
		await assert.rejects(
			() => hashRelativeModuleClosure({ baseDirectory: join(f.root, 'base'), roots: ['root.js'], claim: 'fixture-policy-v1' }),
			/path escaped product closure root|must stay inside/u,
		);
	} finally { await f.cleanup(); }
});

test('module closure rejects a relative import that traverses a symlinked parent directory', async () => {
	const f = await fixture();
	try {
		const base = join(f.root, 'base');
		const external = join(f.root, 'external');
		await mkdir(base, { recursive: true });
		await mkdir(external, { recursive: true });
		await writeFile(join(base, 'root.js'), "export { x } from './linked/escaped.js';\n", 'utf8');
		await writeFile(join(external, 'escaped.js'), 'export const x = 1;\n', 'utf8');
		await symlink(external, join(base, 'linked'), 'dir');
		await assert.rejects(
			() => hashRelativeModuleClosure({ baseDirectory: base, roots: ['root.js'], claim: 'fixture-policy-v1' }),
			/symlink path component/u,
		);
	} finally { await f.cleanup(); }
});

test('canonical digest helper expectation documents raw artifact hash semantics', () => {
	assert.equal(digest(Buffer.from('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
