import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const defaultOutput = '.cache/selfhost/legacy-rollback-smoke.json';
const candidateSha256 = hash('virune-selfhost-rollback-smoke-unavailable-candidate-v1');
const gateNames = [
	'bootstrap-determinism',
	'legacy-compatibility',
	'runtime-behaviour',
	'performance',
	'clean-bootstrap',
	'rollback-smoke',
];
const triggerGate = 'performance';

export function parseArguments(argumentsList) {
	let help = false;
	let json = false;
	let output = defaultOutput;
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
		if (!argument.startsWith('--output=')) throw new Error(`Unknown argument: ${argument}`);
		if (seen.has('output')) throw new Error('Duplicate option: --output');
		seen.add('output');
		output = nonEmpty(argument.slice('--output='.length), '--output');
	}
	if (help && seen.size > 1) throw new Error('--help cannot be combined with other options');
	return { help, json, output };
}

export function resolveCachePath(repositoryRoot, value) {
	if (isAbsolute(value)) throw new Error('--output must be repository-relative');
	const absolutePath = resolve(repositoryRoot, value);
	const repositoryRelative = relative(repositoryRoot, absolutePath);
	if (
		repositoryRelative === ''
		|| repositoryRelative === '..'
		|| repositoryRelative.startsWith(`..${sep}`)
		|| isAbsolute(repositoryRelative)
	) {
		throw new Error('--output must stay inside the repository');
	}
	if (!(repositoryRelative === '.cache' || repositoryRelative.startsWith(`.cache${sep}`))) {
		throw new Error('--output must be inside .cache');
	}
	if (!repositoryRelative.endsWith('.json')) throw new Error('--output must end in .json');
	return { absolutePath, repositoryRelative };
}

export function readGitRepositoryState(repositoryRoot, execute = execFileSync) {
	const repositoryCommit = execute('git', ['rev-parse', 'HEAD'], {
		cwd: repositoryRoot,
		encoding: 'utf8',
		windowsHide: true,
	}).trim();
	if (!/^[0-9a-f]{40}$/u.test(repositoryCommit)) {
		throw new Error('git rev-parse HEAD did not return a canonical commit SHA');
	}
	const status = execute('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
		cwd: repositoryRoot,
		encoding: 'utf8',
		windowsHide: true,
	});
	return { repositoryCommit, workingTreeClean: status.trim() === '' };
}

export function createRollbackDecisionInput(checkedAt) {
	return {
		version: 1,
		candidateVersion: 'rollback-smoke-unavailable-candidate-v1',
		candidateSha256,
		releaseVersion: 'rollback-smoke',
		evaluatedAt: checkedAt,
		maximumEvidenceAgeSeconds: 3_600,
		gates: gateNames.map((name, index) => ({
			name,
			candidateSha256,
			checkedAt,
			status: name === triggerGate ? 'fail' : 'pass',
			evidenceSha256: hash(`virune-selfhost-rollback-smoke-gate-v1:${index}:${name}`),
		})),
	};
}

export async function runRollbackSmoke({
	repositoryRoot,
	dependencies,
	now = () => new Date(),
}) {
	const repository = await dependencies.readRepositoryState(repositoryRoot);
	if (!repository.workingTreeClean) {
		throw new Error('Legacy rollback smoke requires a clean Git working tree');
	}
	const checkedAt = canonicalTimestamp(now());
	let candidateAccessed = false;
	const request = {
		rollbackDecision: createRollbackDecisionInput(checkedAt),
		input: kernelInput(),
		get selfHostCandidate() {
			candidateAccessed = true;
			throw new Error('Self-host candidate must remain inaccessible during Legacy rollback');
		},
	};
	const result = await dependencies.executeBootstrapCompilerSelection(request);
	assertRollbackResult(result, candidateAccessed);
	const report = {
		schemaVersion: 1,
		claim: 'selfhost-legacy-rollback-smoke',
		productionEligible: false,
		status: 'pass',
		repositoryCommit: repository.repositoryCommit,
		workingTreeClean: true,
		checkedAt,
		triggerGate,
		candidateSha256,
		candidateAccessed,
		selection: result.selection,
		rollbackRequired: result.rollback.decision.rollbackRequired,
		rollbackReasons: result.rollback.decision.reasons,
		decisionSha256: result.rollback.sha256,
		materializedStageArtifactSha256: result.materializedStageArtifactSha256,
		output: {
			accepted: result.output.accepted,
			diagnosticCount: result.output.diagnostics.length,
			emittedModuleCount: result.output.emittedModules.length,
		},
	};
	return {
		...report,
		evidenceSha256: hash(JSON.stringify(report)),
	};
}

export function helpText() {
	return [
		'Usage: npm run selfhost:rollback-smoke -- [--json] [--output=<.cache/file.json>]',
		'',
		'Forces a fail-closed rollback decision, proves the Self-host candidate is never accessed,',
		'and compiles a canonical Kernel input through the real Legacy compiler in a clean Git checkout.',
	].join('\n');
}

export async function main(argumentsList = process.argv.slice(2), injected = {}) {
	const options = parseArguments(argumentsList);
	if (options.help) {
		console.log(helpText());
		return null;
	}
	const repositoryRoot = resolve(injected.repositoryRoot ?? fileURLToPath(new URL('..', import.meta.url)));
	const output = resolveCachePath(repositoryRoot, options.output);
	const dependencies = injected.dependencies ?? await loadDependencies();
	const evidence = await runRollbackSmoke({
		repositoryRoot,
		dependencies,
		...(injected.now === undefined ? {} : { now: injected.now }),
	});
	await mkdir(dirname(output.absolutePath), { recursive: true });
	const encoded = `${JSON.stringify(evidence)}\n`;
	await writeFile(output.absolutePath, encoded, 'utf8');
	if (options.json) process.stdout.write(encoded);
	else {
		console.log('Self-host Legacy rollback smoke: PASS');
		console.log(`Repository: ${evidence.repositoryCommit}`);
		console.log(`Selection: ${evidence.selection}`);
		console.log(`Candidate accessed: ${String(evidence.candidateAccessed)}`);
		console.log(`Evidence: ${output.repositoryRelative}`);
	}
	return evidence;
}

async function loadDependencies() {
	const selectionModule = await import('../packages/compiler/dist/src/selfhost/bootstrap-compiler-selection.js');
	return {
		readRepositoryState: readGitRepositoryState,
		executeBootstrapCompilerSelection: selectionModule.executeBootstrapCompilerSelection,
	};
}

function assertRollbackResult(result, candidateAccessed) {
	if (candidateAccessed) throw new Error('Legacy rollback accessed the Self-host candidate');
	if (result.selection !== 'legacy') throw new Error(`Legacy rollback selected ${String(result.selection)}`);
	if (!result.rollback.decision.rollbackRequired) throw new Error('Legacy rollback was not marked required');
	if (
		result.rollback.decision.reasons.length !== 1
		|| result.rollback.decision.reasons[0]?.gate !== triggerGate
		|| result.rollback.decision.reasons[0]?.code !== 'FAILED'
	) {
		throw new Error('Legacy rollback did not preserve the expected performance gate failure');
	}
	if (result.materializedStageArtifactSha256 !== null) {
		throw new Error('Legacy rollback materialized a Self-host Stage artifact');
	}
	if (!result.output.accepted) throw new Error('Legacy compiler rejected the canonical rollback smoke input');
	if (result.output.diagnostics.some(diagnostic => diagnostic.severity === 'error')) {
		throw new Error('Legacy compiler emitted an error diagnostic for the rollback smoke input');
	}
	if (result.output.emittedModules.length === 0) {
		throw new Error('Legacy compiler emitted no module for the rollback smoke input');
	}
}

function kernelInput() {
	return {
		contractVersion: '1',
		languageVersion: '1.0',
		platform: 'node',
		entryPath: 'src/main.virune',
		sources: [{
			path: 'src/main.virune',
			text: 'pub fn main() -> Int {\n\treturn 0\n}\n',
		}],
		interopManifest: { version: '1', modules: [] },
		emit: { target: 'es2022', sourceMap: false, sourcesContent: true },
	};
}

function canonicalTimestamp(value) {
	const date = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(date.getTime())) throw new Error('rollback smoke clock returned an invalid timestamp');
	return date.toISOString();
}

function hash(value) {
	return createHash('sha256').update(value, 'utf8').digest('hex');
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
		console.error(`SELFHOST_ROLLBACK_SMOKE_ERROR ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	}
}
