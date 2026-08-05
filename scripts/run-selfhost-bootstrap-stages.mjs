import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const defaultProject = 'selfhost/mvp';
const defaultOutput = '.cache/selfhost/bootstrap-stages.json';
const defaultTemporaryRoot = '.cache/selfhost/bootstrap-candidates';
const seedManifestPath = '.github/self-hosting/stage0-seed.json';

export function parseArguments(argumentsList) {
	let help = false;
	let json = false;
	let output = defaultOutput;
	let project = defaultProject;
	let temporaryRoot = defaultTemporaryRoot;
	const seen = new Set();
	for (const argument of argumentsList) {
		if (argument === '--help' || argument === '--json') {
			const name = argument.slice(2);
			if (seen.has(name)) throw new Error(`Duplicate option: ${argument}`);
			seen.add(name);
			if (argument === '--help') help = true;
			else json = true;
			continue;
		}
		const option = ['project', 'output', 'temporary-root']
			.find(name => argument.startsWith(`--${name}=`));
		if (option === undefined) throw new Error(`Unknown argument: ${argument}`);
		if (seen.has(option)) throw new Error(`Duplicate option: --${option}`);
		seen.add(option);
		const value = nonEmpty(argument.slice(option.length + 3), `--${option}`);
		if (option === 'project') project = value;
		else if (option === 'output') output = value;
		else temporaryRoot = value;
	}
	if (help && seen.size > 1) throw new Error('--help cannot be combined with other options');
	return { help, json, output, project, temporaryRoot };
}

export function resolveRepositoryPath(repositoryRoot, value, option) {
	if (isAbsolute(value)) throw new Error(`${option} must be repository-relative`);
	const absolutePath = resolve(repositoryRoot, value);
	const repositoryRelative = relative(repositoryRoot, absolutePath);
	if (
		repositoryRelative === ''
		|| repositoryRelative === '..'
		|| repositoryRelative.startsWith(`..${sep}`)
		|| isAbsolute(repositoryRelative)
	) {
		throw new Error(`${option} must stay inside the repository`);
	}
	return { absolutePath, repositoryRelative };
}

export function resolveCachePath(repositoryRoot, value, option, extension = null) {
	const resolved = resolveRepositoryPath(repositoryRoot, value, option);
	if (!(resolved.repositoryRelative === '.cache' || resolved.repositoryRelative.startsWith(`.cache${sep}`))) {
		throw new Error(`${option} must be inside .cache`);
	}
	if (extension !== null && !resolved.repositoryRelative.endsWith(extension)) {
		throw new Error(`${option} must end in ${extension}`);
	}
	return resolved;
}

export function createBootstrapEvidence(readiness, execution = null) {
	const ready = readiness.evidence.ready
		&& readiness.evidence.capabilityReady
		&& readiness.evidence.blockers.length === 0
		&& readiness.evidence.capabilityBlockers.length === 0;
	const status = !ready ? 'blocked' : execution?.equivalent === true ? 'match' : 'mismatch';
	return {
		schemaVersion: 1,
		claim: 'stage1-stage2-bootstrap',
		productionEligible: false,
		status,
		readiness: {
			sha256: readiness.sha256,
			evidence: readiness.evidence,
		},
		stage1: execution === null ? null : {
			sha256: execution.stage1.sha256,
			moduleCount: execution.stage1.modules.length,
		},
		stage2: execution === null ? null : {
			sha256: execution.stage2.sha256,
			moduleCount: execution.stage2.modules.length,
		},
		equivalent: execution?.equivalent ?? false,
		differences: execution?.differences ?? [],
	};
}

export function helpText() {
	return [
		'Usage: npm run selfhost:bootstrap -- [--json] [--project=<path>] [--output=<.cache/file.json>] [--temporary-root=<.cache/path>]',
		'',
		'Evaluates the versioned Stage 1/Stage 2 readiness witnesses, executes both stages through real emitted artifacts,',
		'and writes deterministic JSON evidence. Blocked readiness and non-equivalent artifacts fail after evidence is written.',
	].join('\n');
}

export async function runBootstrapStages({
	repositoryRoot,
	projectPath,
	temporaryRoot,
	dependencies,
}) {
	const manifest = JSON.parse(await readFile(resolve(repositoryRoot, seedManifestPath), 'utf8'));
	const seed = readSeedWitness(manifest);
	const readiness = await dependencies.evaluateSelfhostStageBootstrapReadiness(projectPath, {
		temporaryRoot,
		compilerVersion: seed.compilerVersion,
		runtimeAbi: seed.runtimeAbi,
		interopAbi: seed.interopAbi,
		seedSha256: seed.seedSha256,
	});
	if (!readiness.evidence.ready) return createBootstrapEvidence(readiness);
	const build = await dependencies.buildProject(projectPath, { write: false });
	const input = dependencies.kernelInputFromProjectBuild(build);
	const execution = await dependencies.executeReadyBootstrapStages(readiness, input, { temporaryRoot });
	return createBootstrapEvidence(readiness, execution);
}

export async function main(argumentsList = process.argv.slice(2), injectedDependencies = null) {
	const options = parseArguments(argumentsList);
	if (options.help) {
		console.log(helpText());
		return;
	}
	const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
	const project = resolveRepositoryPath(repositoryRoot, options.project, '--project');
	const output = resolveCachePath(repositoryRoot, options.output, '--output', '.json');
	const temporary = resolveCachePath(repositoryRoot, options.temporaryRoot, '--temporary-root');
	const dependencies = injectedDependencies ?? await loadDependencies();
	await mkdir(temporary.absolutePath, { recursive: true });
	const evidence = await runBootstrapStages({
		repositoryRoot,
		projectPath: project.absolutePath,
		temporaryRoot: temporary.absolutePath,
		dependencies,
	});
	const encoded = `${JSON.stringify(evidence)}\n`;
	await mkdir(dirname(output.absolutePath), { recursive: true });
	await writeFile(output.absolutePath, encoded, 'utf8');
	if (options.json) process.stdout.write(encoded);
	else {
		console.log(`Self-host bootstrap: ${evidence.status.toUpperCase()}`);
		console.log(`Readiness: ${evidence.readiness.evidence.ready ? 'ready' : 'blocked'}`);
		console.log(`Stage 1: ${evidence.stage1?.sha256 ?? 'not executed'}`);
		console.log(`Stage 2: ${evidence.stage2?.sha256 ?? 'not executed'}`);
		console.log(`Differences: ${evidence.differences.length}`);
		console.log(`JSON: ${output.repositoryRelative}`);
	}
	if (evidence.status === 'blocked') {
		const blockers = [
			...evidence.readiness.evidence.blockers,
			...evidence.readiness.evidence.capabilityBlockers,
		];
		throw new Error(`Stage 1/Stage 2 bootstrap is blocked (${blockers.join(', ') || 'unknown blocker'})`);
	}
	if (evidence.status !== 'match') {
		throw new Error(`Stage 1/Stage 2 artifacts differ (${evidence.differences.length} difference(s))`);
	}
}

async function loadDependencies() {
	const [projectModule, runnerModule, pipelineModule] = await Promise.all([
		import('../packages/compiler/dist/src/project/project.js'),
		import('../packages/compiler/dist/src/selfhost/bootstrap-stage-runner.js'),
		import('../packages/compiler/dist/src/selfhost/bootstrap-stage-pipeline.js'),
	]);
	return {
		buildProject: projectModule.buildProject,
		evaluateSelfhostStageBootstrapReadiness: runnerModule.evaluateSelfhostStageBootstrapReadiness,
		kernelInputFromProjectBuild: runnerModule.kernelInputFromProjectBuild,
		executeReadyBootstrapStages: pipelineModule.executeReadyBootstrapStages,
	};
}

function readSeedWitness(manifest) {
	const compilerVersion = nonEmpty(manifest?.viruneVersion, 'stage0 seed viruneVersion');
	const runtimeAbi = nonEmpty(manifest?.baselines?.runtimeAbi, 'stage0 seed runtimeAbi');
	const interopAbi = nonEmpty(manifest?.baselines?.interopAbi, 'stage0 seed interopAbi');
	const seedSha256 = nonEmpty(manifest?.artifact?.sha256, 'stage0 seed artifact sha256').toLowerCase();
	if (!/^[0-9a-f]{64}$/u.test(seedSha256)) throw new Error('stage0 seed artifact sha256 must be a SHA-256 value');
	return { compilerVersion, runtimeAbi, interopAbi, seedSha256 };
}

function nonEmpty(value, option) {
	if (typeof value !== 'string' || value.trim() === '') throw new Error(`${option} must be a non-empty string`);
	return value.trim();
}

const directExecution = process.argv[1] !== undefined
	&& import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (directExecution) {
	try {
		await main();
	} catch (error) {
		console.error(`SELFHOST_BOOTSTRAP_ERROR ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	}
}
