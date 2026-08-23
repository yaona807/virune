import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { hashRequiredSelfhostHostContract } from './selfhost-promotion-host-contract.mjs';

export const PROMOTION_SUBJECT_REPORT_SCHEMA_VERSION = 1;
export const DEFAULT_PROMOTION_SUBJECT_OUTPUT = '.cache/selfhost-promotion-observation/promotion-subject.json';
export const REQUIRED_SELFHOST_HOST_FILES = Object.freeze([
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

const sha256Pattern = /^[0-9a-f]{64}$/u;
const builtins = new Set([...builtinModules, ...builtinModules.map(name => `node:${name}`)]);
const unboundPackageExecutionFields = Object.freeze([
	'browser',
	'cpu',
	'imports',
	'libc',
	'main',
	'module',
	'optionalDependencies',
	'os',
	'peerDependencies',
	'peerDependenciesMeta',
	'sideEffects',
]);
const sourceRoot = fileURLToPath(new URL('..', import.meta.url));

export async function createRequiredSelfhostPromotionSubject({
	repositoryRoot = sourceRoot,
	releaseCorePath = '.cache/selfhost-promotion-observation/release-core.json',
	outputPath = DEFAULT_PROMOTION_SUBJECT_OUTPUT,
} = {}) {
	const root = resolve(repositoryRoot);
	const releaseCoreFile = await resolveNonSymlinkInside(root, releaseCorePath, 'releaseCorePath', 'file');
	const releaseCoreBytes = await readFile(releaseCoreFile);
	const bindings = validateReleaseCore(parseJsonObject(releaseCoreBytes, 'release-core'));
	const seedManifestFile = await resolveNonSymlinkInside(root, '.github/self-hosting/stage0-seed.json', 'stage0-seed', 'file');
	const seedManifestBytes = await readFile(seedManifestFile);
	const seedManifest = parseJsonObject(seedManifestBytes, 'stage0-seed');
	const seedArtifactSha256 = canonicalSha(seedManifest?.artifact?.sha256, 'stage0-seed.artifact.sha256');
	if (seedArtifactSha256 !== bindings.seedArtifactSha256) throw new Error('Stage 0 Seed artifact SHA does not match release-core verified Seed identity');
	const runtimeAbi = canonicalText(seedManifest?.baselines?.runtimeAbi, 'stage0-seed.baselines.runtimeAbi');
	const compilerDist = await resolveNonSymlinkInside(root, 'packages/compiler/dist/src', 'compilerDist', 'directory');
	const runtimePackageRoot = await resolveNonSymlinkInside(root, 'packages/runtime', 'runtimePackageRoot', 'directory');
	const stdlibPackageRoot = await resolveNonSymlinkInside(root, 'packages/stdlib', 'stdlibPackageRoot', 'directory');
	const components = [
		{ id: 'bootstrap-policy', sha256: (await hashRelativeModuleClosure({ baseDirectory: compilerDist, roots: ['selfhost/bootstrap-artifact-normalizer.js'], claim: 'selfhost-bootstrap-normalization-policy-v1' })).sha256 },
		{ id: 'fixed-seed', sha256: bindings.seedArtifactSha256 },
		{ id: 'runtime-abi', sha256: sha256(JSON.stringify({ version: 1, claim: 'virune-runtime-abi', value: runtimeAbi })) },
		{ id: 'runtime-artifact', sha256: (await hashPackageProductSurface({ packageRoot: runtimePackageRoot, claim: 'runtime-product-v1' })).sha256 },
		{ id: 'selfhost-host-contract', sha256: (await hashRequiredSelfhostHostContract({ repositoryRoot: root, compilerDist, files: REQUIRED_SELFHOST_HOST_FILES })).sha256 },
		{ id: 'selfhost-stage3', sha256: bindings.stage3Sha256 },
		{ id: 'stdlib-artifact', sha256: (await hashPackageProductSurface({ packageRoot: stdlibPackageRoot, claim: 'stdlib-product-v1' })).sha256 },
	];
	const { createPromotionSubjectManifest } = await import('../packages/compiler/dist/src/selfhost/promotion-subject.js');
	const subject = createPromotionSubjectManifest({ version: 2, stage: 'required-selfhost', components });
	const report = {
		schemaVersion: PROMOTION_SUBJECT_REPORT_SCHEMA_VERSION,
		claim: 'required-selfhost-promotion-subject',
		productionEligible: false,
		stage: 'required-selfhost',
		promotionSubjectId: subject.promotionSubjectId,
		manifest: subject.manifest,
		sources: {
			releaseCoreSha256: sha256(releaseCoreBytes),
			seedManifestSha256: sha256(seedManifestBytes),
			seedArtifactSha256: bindings.seedArtifactSha256,
			stage3Sha256: bindings.stage3Sha256,
			runtimeAbi,
		},
	};
	const serialized = JSON.stringify(report);
	const target = resolveInside(root, outputPath, 'outputPath');
	await mkdir(dirname(target), { recursive: true });
	await writeFile(target, serialized, 'utf8');
	return { report, serialized, evidenceSha256: sha256(serialized) };
}

export async function hashPackageProductSurface({ packageRoot, claim }) {
	const root = resolve(packageRoot);
	const packageFile = await resolveNonSymlinkInside(root, 'package.json', 'package.json', 'file');
	const packageBytes = await readFile(packageFile);
	const packageManifest = parseJsonObject(packageBytes, `${claim}.package.json`);
	assertNoUnboundPackageExecutionMetadata(packageManifest, claim);
	const packageSurface = {
		name: canonicalText(packageManifest.name, `${claim}.package.name`),
		version: canonicalText(packageManifest.version, `${claim}.package.version`),
		type: canonicalText(packageManifest.type, `${claim}.package.type`),
		engines: canonicalStringRecord(packageManifest.engines, `${claim}.package.engines`),
		exports: canonicalStringRecord(packageManifest.exports, `${claim}.package.exports`),
		dependencies: packageManifest.dependencies === undefined
			? {}
			: canonicalStringRecord(packageManifest.dependencies, `${claim}.package.dependencies`),
	};
	const artifactRoot = await resolveNonSymlinkInside(root, 'dist/src', 'dist/src', 'directory');
	const artifact = await hashArtifactTree(artifactRoot, `${claim}-dist-src`);
	const manifest = {
		version: 1,
		claim: canonicalText(claim, 'claim'),
		package: packageSurface,
		artifactSha256: artifact.sha256,
	};
	const serialized = JSON.stringify(manifest);
	return { manifest, serialized, sha256: sha256(serialized) };
}

export async function hashArtifactTree(rootDirectory, claim) {
	const root = resolve(rootDirectory);
	const files = [];
	await collectArtifactFiles(root, root, files);
	if (files.length === 0) throw new Error(`${claim} artifact tree is empty: ${root}`);
	files.sort((left, right) => compareText(left.path, right.path));
	const manifest = { version: 1, claim: canonicalText(claim, 'claim'), files };
	const serialized = JSON.stringify(manifest);
	return { manifest, serialized, sha256: sha256(serialized) };
}

export async function hashFixedModuleSet({ baseDirectory, files, claim }) {
	const base = resolve(baseDirectory);
	if (!Array.isArray(files) || files.length === 0) throw new Error('files must contain at least one relative module path');
	const canonicalFiles = files.map((value, index) => canonicalRelativeModulePath(value, `files[${index}]`));
	if (new Set(canonicalFiles).size !== canonicalFiles.length) throw new Error('files must not contain duplicate module paths');
	canonicalFiles.sort(compareText);
	const entries = [];
	for (const relativePath of canonicalFiles) {
		const absolutePath = await resolveNonSymlinkInside(base, relativePath, `module ${relativePath}`, 'file');
		const bytes = await readFile(absolutePath);
		entries.push({ path: relativePath, sha256: sha256(bytes), bytes: bytes.byteLength });
	}
	const manifest = { version: 1, claim: canonicalText(claim, 'claim'), files: entries };
	const serialized = JSON.stringify(manifest);
	return { manifest, serialized, sha256: sha256(serialized) };
}

export async function hashRelativeModuleClosure({ baseDirectory, roots, claim }) {
	const base = resolve(baseDirectory);
	if (!Array.isArray(roots) || roots.length === 0) throw new Error('roots must contain at least one relative module path');
	const queue = roots.map((value, index) => canonicalRelativeModulePath(value, `roots[${index}]`));
	const seen = new Set();
	const files = [];
	while (queue.length > 0) {
		queue.sort(compareText);
		const relativePath = queue.shift();
		if (seen.has(relativePath)) continue;
		seen.add(relativePath);
		const absolutePath = await resolveNonSymlinkInside(base, relativePath, `module ${relativePath}`, 'file');
		const bytes = await readFile(absolutePath);
		files.push({ path: relativePath, sha256: sha256(bytes), bytes: bytes.byteLength });
		if (relativePath.endsWith('.js') || relativePath.endsWith('.mjs')) {
			for (const specifier of await relativeModuleSpecifiers(bytes.toString('utf8'), relativePath)) {
				const imported = await resolveRelativeModuleSpecifier(base, absolutePath, specifier);
				if (!seen.has(imported)) queue.push(imported);
			}
		}
	}
	files.sort((left, right) => compareText(left.path, right.path));
	const manifest = { version: 1, claim: canonicalText(claim, 'claim'), roots: [...new Set(roots.map(value => canonicalRelativeModulePath(value, 'root')))].sort(compareText), files };
	const serialized = JSON.stringify(manifest);
	return { manifest, serialized, sha256: sha256(serialized) };
}

export async function relativeModuleSpecifiers(source, fileName = 'module.js') {
	const relativeImports = new Set();
	const unsupportedImports = new Set();
	try {
		await build({
			stdin: { contents: source, sourcefile: fileName, loader: 'js' },
			bundle: true,
			format: 'esm',
			platform: 'neutral',
			write: false,
			logLevel: 'silent',
			logOverride: {
				'unsupported-dynamic-import': 'error',
				'unsupported-require-call': 'error',
			},
			plugins: [{
				name: 'collect-relative-module-specifiers',
				setup(buildContext) {
					buildContext.onResolve({ filter: /.*/ }, args => {
						if (args.path.startsWith('.')) relativeImports.add(args.path);
						else if (!isBuiltin(args.path)) unsupportedImports.add(args.path);
						return { path: args.path, external: true };
					});
				},
			}],
		});
	} catch (error) {
		throw new Error(`compiled Host module ${fileName} is not valid JavaScript or contains non-analyzable module loading: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (unsupportedImports.size > 0) {
		throw new Error(`compiled Host module ${fileName} has unsupported external imports: ${[...unsupportedImports].sort(compareText).join(', ')}`);
	}
	return [...relativeImports].sort(compareText);
}

function validateReleaseCore(value) {
	if (!isRecord(value) || value.schemaVersion !== 2 || value.claim !== 'selfhost-stable-release-gate-core' || value.productionEligible !== false || value.passed !== true) throw new Error('release-core does not prove a successful non-promotable self-host release core');
	validateSelfHash(value, 'release-core');
	if (value.evidenceConsistency?.checked !== true || value.evidenceConsistency?.passed !== true) throw new Error('release-core cross-step evidence consistency is not successful');
	const bindings = value.evidenceConsistency.bindings;
	if (!isRecord(bindings)) throw new Error('release-core evidence consistency bindings are missing');
	return { seedArtifactSha256: canonicalSha(bindings.seedArtifactSha256, 'release-core.bindings.seedArtifactSha256'), stage3Sha256: canonicalSha(bindings.stage3Sha256, 'release-core.bindings.stage3Sha256') };
}

async function collectArtifactFiles(root, directory, output) {
	const stats = await lstat(directory);
	if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error(`artifact directory must be a non-symlink directory: ${directory}`);
	for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) => compareText(left.name, right.name))) {
		const absolutePath = resolve(directory, entry.name);
		if (entry.isSymbolicLink()) throw new Error(`artifact tree must not contain symlinks: ${absolutePath}`);
		if (entry.isDirectory()) await collectArtifactFiles(root, absolutePath, output);
		else if (entry.isFile()) { const bytes = await readFile(absolutePath); output.push({ path: portableRelative(root, absolutePath), sha256: sha256(bytes), bytes: bytes.byteLength }); }
		else throw new Error(`artifact tree contains a non-regular entry: ${absolutePath}`);
	}
}

async function resolveRelativeModuleSpecifier(base, importer, specifier) {
	const imported = resolve(dirname(importer), specifier);
	const candidates = /\.(?:m?js|json)$/u.test(specifier) ? [imported] : [`${imported}.js`, `${imported}.mjs`, `${imported}.json`, resolve(imported, 'index.js')];
	for (const candidate of candidates) {
		try {
			const relativePath = portableRelative(base, candidate);
			const safeCandidate = await resolveNonSymlinkInside(base, relativePath, `relative import ${specifier}`, 'file');
			return portableRelative(base, safeCandidate);
		} catch (error) {
			if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
		}
	}
	throw new Error(`relative module import cannot be resolved inside product closure: ${specifier} from ${portableRelative(base, importer)}`);
}

function resolveInside(root, value, label) {
	if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} must be a non-empty path`);
	const absolute = resolve(root, value);
	const relation = relative(root, absolute);
	if (relation === '..' || relation.startsWith(`..${sep}`) || relation.startsWith('/') || relation.startsWith('\\')) throw new Error(`${label} must stay inside ${root}`);
	return absolute;
}
async function resolveNonSymlinkInside(root, value, label, expectedType) {
	const absolute = resolveInside(root, value, label);
	const rootStats = await lstat(root);
	if (rootStats.isSymbolicLink()) throw new Error(`${label} traverses a symlink path component: ${root}`);
	const relation = relative(root, absolute);
	let current = root;
	let finalStats = rootStats;
	if (relation !== '') {
		for (const component of relation.split(sep).filter(Boolean)) {
			current = resolve(current, component);
			finalStats = await lstat(current);
			if (finalStats.isSymbolicLink()) throw new Error(`${label} traverses a symlink path component: ${current}`);
		}
	}
	if (expectedType === 'file' && !finalStats.isFile()) throw new Error(`${label} must resolve to a regular non-symlink file`);
	if (expectedType === 'directory' && !finalStats.isDirectory()) throw new Error(`${label} must resolve to a non-symlink directory`);
	return absolute;
}
function portableRelative(root, absolutePath) { const relation = relative(root, absolutePath); if (relation === '' || relation === '..' || relation.startsWith(`..${sep}`)) throw new Error(`path escaped product closure root: ${absolutePath}`); return relation.replaceAll('\\', '/'); }
function canonicalRelativeModulePath(value, label) { const text = canonicalText(value, label).replaceAll('\\', '/'); if (text.startsWith('/') || text.startsWith('../') || text.includes('/../') || text === '..' || text.startsWith('./')) throw new Error(`${label} must be a canonical repository-relative module path`); return text; }
function canonicalStringRecord(value, label) {
	if (!isRecord(value)) throw new Error(`${label} must be an object of canonical strings`);
	const result = {};
	for (const key of Object.keys(value).sort(compareText)) {
		const canonicalKey = canonicalText(key, `${label}.key`);
		result[canonicalKey] = canonicalText(value[key], `${label}.${canonicalKey}`);
	}
	return result;
}
function assertNoUnboundPackageExecutionMetadata(value, claim) {
	const present = unboundPackageExecutionFields.filter(field => value[field] !== undefined);
	if (present.length > 0) {
		throw new Error(`${claim}.package.json has unsupported execution-relevant metadata: ${present.join(', ')}`);
	}
}
function validateSelfHash(value, label) { const claimed = canonicalSha(value.evidenceSha256, `${label}.evidenceSha256`); const { evidenceSha256: _sha, ...record } = value; if (sha256(JSON.stringify(record)) !== claimed) throw new Error(`${label} self-hash is invalid`); }
function parseJsonObject(bytes, label) { let value; try { value = JSON.parse(bytes.toString('utf8')); } catch (error) { throw new Error(`${label} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`); } if (!isRecord(value)) throw new Error(`${label} must be a JSON object`); return value; }
function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function isBuiltin(value) { return builtins.has(value) || (value.startsWith('node:') && builtins.has(value.slice('node:'.length))); }
function canonicalSha(value, label) { if (typeof value !== 'string' || !sha256Pattern.test(value)) throw new Error(`${label} must be a canonical lowercase SHA-256`); return value; }
function canonicalText(value, label) { if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) throw new Error(`${label} must be a non-empty canonical string`); return value; }
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function compareText(left, right) { return left < right ? -1 : left > right ? 1 : 0; }
function parseArguments(argumentsList) { const options = {}; for (const argument of argumentsList) { if (argument.startsWith('--release-core=')) options.releaseCorePath = argument.slice('--release-core='.length); else if (argument.startsWith('--output=')) options.outputPath = argument.slice('--output='.length); else throw new Error(`Unknown argument: ${argument}`); } return options; }

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const result = await createRequiredSelfhostPromotionSubject(parseArguments(process.argv.slice(2)));
	console.log(JSON.stringify({ promotionSubjectId: result.report.promotionSubjectId, evidenceSha256: result.evidenceSha256 }));
}
