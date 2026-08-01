import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBootstrapExecutionProbe } from '../packages/compiler/dist/src/selfhost/bootstrap-execution-probe.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mvpRoot = join(repositoryRoot, 'selfhost', 'mvp');
const arguments_ = parseArguments(process.argv.slice(2));
const outputDirectory = resolve(repositoryRoot, arguments_.output);
const temporaryRoot = join(outputDirectory, 'tmp');
const seed = JSON.parse(await readFile(join(repositoryRoot, '.github/self-hosting/stage0-seed.json'), 'utf8'));

const input = source => ({
	contractVersion: '1',
	languageVersion: seed.languageVersion,
	platform: 'node',
	entryPath: 'src/main.virune',
	sources: [{ path: 'src/main.virune', text: source }],
	interopManifest: { version: '1', modules: [] },
	emit: { target: 'es2022', sourceMap: false, sourcesContent: true },
});

const probeOptions = {
	temporaryRoot,
	compilerVersion: seed.viruneVersion,
	runtimeAbi: seed.baselines.runtimeAbi,
	interopAbi: seed.baselines.interopAbi,
	seedSha256: seed.artifact.sha256,
};

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

const accepted = await runBootstrapExecutionProbe(
	mvpRoot,
	input('pub fn main() -> Int {\n\treturn 42\n}\n'),
	probeOptions,
);
const rejected = await runBootstrapExecutionProbe(
	mvpRoot,
	input('pub fn main() -> Int {\n\treturn missing\n}\n'),
	probeOptions,
);

if (!accepted.output.accepted) throw new Error('Accepted Nightly probe input was rejected');
if (rejected.output.accepted) throw new Error('Rejected Nightly probe input was accepted');
if (accepted.compilerArtifact.sha256 !== rejected.compilerArtifact.sha256) {
	throw new Error('Nightly probes did not execute the same compiler artifact');
}

const completedAt = new Date().toISOString();
const run = {
	version: 1,
	claim: 'nightly-stage0-compiler-execution-probe',
	productionEligible: false,
	candidateSha: arguments_.candidateSha,
	runId: arguments_.runId,
	completedAt,
	seedId: seed.seedId,
	compilerVersion: seed.viruneVersion,
	compilerArtifactSha256: accepted.compilerArtifact.sha256,
	probes: [
		{ id: 'accepted', accepted: true, evidenceSha256: accepted.sha256 },
		{ id: 'rejected', accepted: false, evidenceSha256: rejected.sha256 },
	],
};
const serializedRun = JSON.stringify(run);

await Promise.all([
	writeEvidence('accepted', accepted),
	writeEvidence('rejected', rejected),
	writeFile(join(outputDirectory, 'compiler-artifact.json'), `${accepted.compilerArtifact.serialized}\n`, 'utf8'),
	writeFile(join(outputDirectory, 'compiler-artifact.sha256'), `${accepted.compilerArtifact.sha256}\n`, 'utf8'),
	writeFile(join(outputDirectory, 'run.json'), `${serializedRun}\n`, 'utf8'),
	writeFile(join(outputDirectory, 'run.sha256'), `${sha256(serializedRun)}\n`, 'utf8'),
]);
await rm(temporaryRoot, { recursive: true, force: true });

console.log(JSON.stringify({
	claim: run.claim,
	productionEligible: run.productionEligible,
	candidateSha: run.candidateSha,
	compilerArtifactSha256: run.compilerArtifactSha256,
	runSha256: sha256(serializedRun),
}));

async function writeEvidence(name, result) {
	await writeFile(join(outputDirectory, `${name}-evidence.json`), `${result.serialized}\n`, 'utf8');
	await writeFile(join(outputDirectory, `${name}-evidence.sha256`), `${result.sha256}\n`, 'utf8');
}

function parseArguments(values) {
	const options = {
		candidateSha: process.env.GITHUB_SHA ?? '',
		runId: process.env.GITHUB_RUN_ID === undefined
			? 'local'
			: `${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT ?? '1'}`,
		output: '.cache/selfhost-nightly-shadow',
	};
	for (const value of values) {
		if (value.startsWith('--candidate-sha=')) options.candidateSha = value.slice('--candidate-sha='.length);
		else if (value.startsWith('--run-id=')) options.runId = value.slice('--run-id='.length);
		else if (value.startsWith('--output=')) options.output = value.slice('--output='.length);
		else throw new Error(`Unknown argument: ${value}`);
	}
	if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(options.candidateSha)) {
		throw new Error('--candidate-sha must be a lowercase 40- or 64-character hexadecimal SHA');
	}
	if (options.runId.length === 0) throw new Error('--run-id must not be empty');
	if (options.output.length === 0) throw new Error('--output must not be empty');
	return options;
}

function sha256(value) {
	return createHash('sha256').update(value, 'utf8').digest('hex');
}
