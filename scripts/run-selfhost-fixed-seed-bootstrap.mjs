import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { verifySelfhostSeed } from './verify-selfhost-seed.mjs';

export const FIXED_SEED_BOOTSTRAP_SCHEMA_VERSION = 1;
export const DEFAULT_FIXED_SEED_OUTPUT = '.cache/selfhost/fixed-seed-bootstrap.json';
export const DEFAULT_FIXED_SEED_TEMPORARY_ROOT = '.cache/selfhost/fixed-seed-bootstrap';
const seedManifestPath = '.github/self-hosting/stage0-seed.json';

export function parseArguments(argumentsList) {
	let help = false;
	let json = false;
	let artifact = null;
	let output = DEFAULT_FIXED_SEED_OUTPUT;
	let project = 'selfhost/mvp';
	let temporaryRoot = DEFAULT_FIXED_SEED_TEMPORARY_ROOT;
	const seen = new Set();
	for (const argument of argumentsList) {
		if (argument === '--help' || argument === '--json') {
			const name = argument.slice(2);
			if (seen.has(name)) throw new Error(`Duplicate option: ${argument}`);
			seen.add(name);
			if (name === 'help') help = true;
			else json = true;
			continue;
		}
		const option = ['artifact', 'output', 'project', 'temporary-root'].find(name => argument.startsWith(`--${name}=`));
		if (option === undefined) throw new Error(`Unknown argument: ${argument}`);
		if (seen.has(option)) throw new Error(`Duplicate option: --${option}`);
		seen.add(option);
		const value = nonEmpty(argument.slice(option.length + 3), `--${option}`);
		if (option === 'artifact') artifact = value;
		else if (option === 'output') output = value;
		else if (option === 'project') project = value;
		else temporaryRoot = value;
	}
	if (help && seen.size > 1) throw new Error('--help cannot be combined with other options');
	return { help, json, artifact, output, project, temporaryRoot };
}

export function createComparisonInput({ root, modules, input, extractExports }) {
	return {
		policyVersion: 1,
		root,
		modules: modules.map(module => ({
			path: module.outputPath,
			code: module.code,
			sourceMap: parseSourceMap(module.sourceMap),
			exports: extractExports(module.code),
		})),
		diagnosticsSchema: { claim: 'project-compiler-result-v1#diagnostics' },
		metadata: {
			contractVersion: input.contractVersion,
			languageVersion: input.languageVersion,
			platform: input.platform,
			target: input.emit.target,
			sourceMap: input.emit.sourceMap,
			sourcesContent: input.emit.sourcesContent,
		},
		checksumManifest: [],
	};
}

export function legacyBuildModules(build) {
	const errors = build.diagnostics.filter(diagnostic => diagnostic.severity === 'error');
	if (errors.length > 0) throw new Error(`Fixed Seed project build failed with ${errors.length} error diagnostic(s)`);
	return build.modules.map(module => {
		if (module.output === undefined || module.outputPath === undefined) {
			throw new Error(`Fixed Seed project build did not emit ${module.source.path}`);
		}
		return {
			sourcePath: relative(build.root, module.source.path).replaceAll('\\', '/'),
			outputPath: module.outputPath,
			code: module.output.code,
			sourceMap: module.output.map,
		};
	});
}

export function selfhostResultModules(result) {
	if (result.accepted !== true) {
		const codes = result.diagnostics.map(diagnostic => diagnostic.code).join(', ') || 'none';
		throw new Error(`Stage 1 compiler rejected Stage 2 build (${codes})`);
	}
	if (result.emittedModules.length === 0) throw new Error('Stage 1 compiler emitted no Stage 2 modules');
	return result.emittedModules.map(module => ({
		sourcePath: module.sourcePath,
		outputPath: module.outputPath,
		code: module.code,
		sourceMap: module.sourceMap,
	}));
}

export function createEvidence({ seed, stage1, stage2, diff, capability }) {
	const equivalent = diff.equal === true && stage1.sha256 === stage2.sha256;
	return {
		schemaVersion: FIXED_SEED_BOOTSTRAP_SCHEMA_VERSION,
		claim: 'fixed-seed-stage1-stage2-bootstrap',
		productionEligible: false,
		status: equivalent ? 'match' : 'mismatch',
		stage0Source: 'fixed-seed-artifact',
		seed: {
			verified: true,
			artifactSha256: seed.artifactSha256,
			manifestSha256: seed.manifestSha256,
			compilerEntry: 'package/dist/src/index.js',
		},
		stage1: { sha256: stage1.sha256, moduleCount: stage1.artifact.modules.length },
		stage2: { sha256: stage2.sha256, moduleCount: stage2.artifact.modules.length },
		capability,
		equivalent,
		differenceCount: diff.changes.length,
		differences: diff.changes.slice(0, 100),
	};
}

export async function runFixedSeedBootstrap({
	repositoryRoot,
	projectPath,
	artifactPath,
	temporaryRoot,
	dependencies,
	seedVerifier = verifySelfhostSeed,
	seedCompilerLoader = extractVerifiedSeedCompiler,
}) {
	const manifestAbsolute = resolve(repositoryRoot, seedManifestPath);
	const manifestBytes = await readFile(manifestAbsolute);
	const manifest = JSON.parse(manifestBytes.toString('utf8'));
	const verified = await seedVerifier({
		root: repositoryRoot,
		...(artifactPath === null ? {} : { artifactPath }),
	});
	if (verified.passed !== true) throw new Error('Fixed Seed verifier did not report success');
	if (verified.sha256 !== manifest.artifact.sha256) throw new Error('Fixed Seed verifier SHA does not match the manifest');
	const seedCompiler = await seedCompilerLoader({
		artifactPath: verified.artifact,
		temporaryRoot,
	});
	let candidateDirectory = null;
	try {
		const stage1Build = await seedCompiler.module.buildProject(projectPath, false);
		const input = dependencies.kernelInputFromProjectBuild(stage1Build);
		const stage1Modules = legacyBuildModules(stage1Build);
		const stage1 = dependencies.normalizeBootstrapArtifact(createComparisonInput({
			root: stage1Build.root,
			modules: stage1Modules,
			input,
			extractExports: dependencies.extractGeneratedModuleExports,
		}));

		const stage1Snapshot = dependencies.snapshotProjectBuild(stage1Build, {
			stage: 'stage1',
			compilerVersion: manifest.viruneVersion,
			runtimeAbi: manifest.baselines.runtimeAbi,
			interopAbi: manifest.baselines.interopAbi,
			seedSha256: verified.sha256,
		});
		candidateDirectory = await dependencies.materializeBootstrapCompilerCandidate(stage1Snapshot, temporaryRoot);
		const candidate = await dependencies.loadBootstrapCompilerCandidate(candidateDirectory, 'dist/main.js');
		if (!dependencies.hasSelfhostProjectCompilerExports(candidate)) {
			throw new Error('Stage 1 compiler is missing project compiler exports');
		}
		const capability = dependencies.readProjectCompilerCapability(candidate);
		if (capability === null || capability.ready !== true) {
			throw new Error(`Stage 1 project compiler is not ready: ${capability?.blockers.join(', ') ?? 'missing capability'}`);
		}
		const stage2Result = dependencies.compileWithProjectCompilerBoundary(candidate, input);
		const stage2Modules = selfhostResultModules(stage2Result);
		const stage2 = dependencies.normalizeBootstrapArtifact(createComparisonInput({
			root: stage1Build.root,
			modules: stage2Modules,
			input,
			extractExports: dependencies.extractGeneratedModuleExports,
		}));
		const diff = dependencies.diffBootstrapArtifacts(stage1, stage2);
		return createEvidence({
			seed: {
				artifactSha256: verified.sha256,
				manifestSha256: sha256(manifestBytes),
			},
			stage1,
			stage2,
			diff,
			capability,
		});
	} finally {
		if (candidateDirectory !== null) await rm(candidateDirectory, { recursive: true, force: true });
		await seedCompiler.dispose();
	}
}

export async function extractVerifiedSeedCompiler({ artifactPath, temporaryRoot }) {
	await mkdir(temporaryRoot, { recursive: true });
	const root = await mkdtemp(join(temporaryRoot, 'verified-seed-'));
	try {
		const result = spawnSync('tar', ['-xzf', artifactPath, '-C', root], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
		if (result.error !== undefined) throw result.error;
		if (result.status !== 0) throw new Error(`Failed to extract fixed Seed: ${(result.stderr || result.stdout).trim()}`);
		const packageRoot = resolve(root, 'package');
		const entry = resolve(packageRoot, 'dist/src/index.js');
		assertInside(packageRoot, entry, 'fixed Seed compiler entry');
		await access(entry);
		const url = new URL(pathToFileURL(entry).href);
		url.searchParams.set('fixed-seed', `${Date.now()}-${Math.random()}`);
		const module = await import(url.href);
		if (typeof module.buildProject !== 'function') throw new Error('Fixed Seed compiler must export buildProject');
		let disposed = false;
		return {
			module,
			packageRoot,
			entry,
			dispose: async () => {
				if (disposed) return;
				disposed = true;
				await rm(root, { recursive: true, force: true });
			},
		};
	} catch (error) {
		await rm(root, { recursive: true, force: true });
		throw error;
	}
}

export function helpText() {
	return [
		'Usage: node scripts/run-selfhost-fixed-seed-bootstrap.mjs [--json] [--artifact=<path>] [--project=<path>] [--output=<.cache/file.json>] [--temporary-root=<.cache/path>]',
		'',
		'Verifies the pinned release Seed artifact, loads that artifact as the actual compiler, uses it to build Stage 1,',
		'loads the emitted Stage 1 compiler, builds Stage 2, and compares normalized compiler artifacts.',
	].join('\n');
}

export async function main(argumentsList = process.argv.slice(2), injected = {}) {
	const options = parseArguments(argumentsList);
	if (options.help) {
		console.log(helpText());
		return null;
	}
	const repositoryRoot = resolve(injected.repositoryRoot ?? fileURLToPath(new URL('..', import.meta.url)));
	const projectPath = resolveRepositoryPath(repositoryRoot, options.project, '--project');
	const output = resolveCachePath(repositoryRoot, options.output, '--output', '.json');
	const temporaryRoot = resolveCachePath(repositoryRoot, options.temporaryRoot, '--temporary-root').absolutePath;
	const artifactPath = options.artifact === null ? null : resolveRepositoryOrAbsolutePath(repositoryRoot, options.artifact);
	const dependencies = injected.dependencies ?? await loadDependencies();
	let evidence;
	try {
		evidence = await runFixedSeedBootstrap({
			repositoryRoot,
			projectPath: projectPath.absolutePath,
			artifactPath,
			temporaryRoot,
			dependencies,
			...(injected.seedVerifier === undefined ? {} : { seedVerifier: injected.seedVerifier }),
			...(injected.seedCompilerLoader === undefined ? {} : { seedCompilerLoader: injected.seedCompilerLoader }),
		});
	} catch (error) {
		evidence = {
			schemaVersion: FIXED_SEED_BOOTSTRAP_SCHEMA_VERSION,
			claim: 'fixed-seed-stage1-stage2-bootstrap',
			productionEligible: false,
			status: 'blocked',
			stage0Source: 'fixed-seed-artifact',
			equivalent: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
	await mkdir(dirname(output.absolutePath), { recursive: true });
	const encoded = `${JSON.stringify(evidence)}\n`;
	await writeFile(output.absolutePath, encoded, 'utf8');
	if (options.json) process.stdout.write(encoded);
	else {
		console.log(`Fixed Seed bootstrap: ${evidence.status.toUpperCase()}`);
		console.log(`Evidence: ${output.repositoryRelative}`);
	}
	if (evidence.status !== 'match') throw new Error(`Fixed Seed Stage 1/2 bootstrap did not match. Evidence: ${output.repositoryRelative}`);
	return evidence;
}

async function loadDependencies() {
	const [snapshotModule, probeModule, runnerModule, adapterModule, normalizerModule] = await Promise.all([
		import('../packages/compiler/dist/src/selfhost/bootstrap-artifact-snapshot.js'),
		import('../packages/compiler/dist/src/selfhost/bootstrap-execution-probe.js'),
		import('../packages/compiler/dist/src/selfhost/bootstrap-stage-runner.js'),
		import('../packages/compiler/dist/src/selfhost/project-compiler-adapter.js'),
		import('../packages/compiler/dist/src/selfhost/bootstrap-artifact-normalizer.js'),
	]);
	return {
		snapshotProjectBuild: snapshotModule.snapshotProjectBuild,
		extractGeneratedModuleExports: snapshotModule.extractGeneratedModuleExports,
		materializeBootstrapCompilerCandidate: probeModule.materializeBootstrapCompilerCandidate,
		loadBootstrapCompilerCandidate: probeModule.loadBootstrapCompilerCandidate,
		kernelInputFromProjectBuild: runnerModule.kernelInputFromProjectBuild,
		hasSelfhostProjectCompilerExports: adapterModule.hasSelfhostProjectCompilerExports,
		readProjectCompilerCapability: adapterModule.readProjectCompilerCapability,
		compileWithProjectCompilerBoundary: adapterModule.compileWithProjectCompilerBoundary,
		normalizeBootstrapArtifact: normalizerModule.normalizeBootstrapArtifact,
		diffBootstrapArtifacts: normalizerModule.diffBootstrapArtifacts,
	};
}

function resolveRepositoryPath(repositoryRoot, value, option) {
	if (isAbsolute(value)) throw new Error(`${option} must be repository-relative`);
	const absolutePath = resolve(repositoryRoot, value);
	const repositoryRelative = relative(repositoryRoot, absolutePath);
	if (repositoryRelative === '' || repositoryRelative === '..' || repositoryRelative.startsWith(`..${sep}`) || isAbsolute(repositoryRelative)) {
		throw new Error(`${option} must stay inside the repository`);
	}
	return { absolutePath, repositoryRelative: repositoryRelative.replaceAll('\\', '/') };
}
function resolveCachePath(repositoryRoot, value, option, extension = null) {
	const resolved = resolveRepositoryPath(repositoryRoot, value, option);
	if (!(resolved.repositoryRelative === '.cache' || resolved.repositoryRelative.startsWith('.cache/'))) throw new Error(`${option} must be inside .cache`);
	if (extension !== null && !resolved.repositoryRelative.endsWith(extension)) throw new Error(`${option} must end in ${extension}`);
	return resolved;
}
function resolveRepositoryOrAbsolutePath(repositoryRoot, value) { return isAbsolute(value) ? resolve(value) : resolve(repositoryRoot, value); }
function assertInside(root, value, label) {
	const candidate = relative(root, value);
	if (candidate === '..' || candidate.startsWith(`..${sep}`) || isAbsolute(candidate)) throw new Error(`${label} escapes verified Seed package`);
}
function parseSourceMap(value) {
	if (typeof value !== 'string') throw new Error('Compiler source map must be a string');
	if (value.trim() === '') return {};
	try { return JSON.parse(value); }
	catch (error) { throw new Error(`Compiler source map is invalid JSON: ${error instanceof Error ? error.message : String(error)}`); }
}
function nonEmpty(value, name) {
	if (typeof value !== 'string' || value.trim() === '') throw new Error(`${name} must be a non-empty string`);
	return value.trim();
}
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }

const directExecution = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (directExecution) {
	try { await main(); }
	catch (error) {
		console.error(`FIXED_SEED_BOOTSTRAP_ERROR ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	}
}
