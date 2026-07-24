import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

export async function runStableReleaseGate({
	root = repositoryRoot,
	output = resolve(root, '.cache/release/release-evidence.json'),
	execute = runCommand,
	fetchLatestNightly = latestNightlyRun,
} = {}) {
	const policy = JSON.parse(await readFile(resolve(root, '.github/stable-release-gate.json'), 'utf8'));
	validatePolicy(policy);
	const packageManifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
	const checks = [];
	for (const configured of policy.checks) {
		const startedAt = Date.now();
		const result = await execute(configured.command, root);
		checks.push({
			id: configured.id,
			command: configured.command,
			passed: result.status === 0,
			status: result.status,
			durationMs: Date.now() - startedAt,
			...(result.outputTail === undefined ? {} : { outputTail: result.outputTail }),
		});
	}

	const nightly = await fetchLatestNightly(policy.nightly);
	checks.push({ id: 'nightly', ...nightly });
	const byId = new Map(checks.map(check => [check.id, check]));
	const requirements = policy.requirements.map(requirement => {
		const evidence = requirement.evidence.map(id => byId.get(id));
		return {
			id: requirement.id,
			evidence: requirement.evidence,
			passed: evidence.every(item => item?.passed === true),
		};
	});
	const report = {
		schemaVersion: 1,
		version: packageManifest.version,
		commit: process.env.GITHUB_SHA ?? null,
		ref: process.env.GITHUB_REF ?? null,
		generatedAt: new Date().toISOString(),
		checks,
		requirements,
		passed: checks.every(check => check.passed) && requirements.every(requirement => requirement.passed),
	};
	await mkdir(dirname(output), { recursive: true });
	await writeFile(output, `${JSON.stringify(report, null, '\t')}\n`, 'utf8');
	for (const requirement of requirements) {
		console.log(`[release-gate] ${requirement.passed ? 'PASS' : 'FAIL'} ${requirement.id} <- ${requirement.evidence.join(', ')}`);
	}
	if (!report.passed) throw new Error(`Stable release gate failed. Evidence: ${output}`);
	console.log(`Stable release gate passed. Evidence: ${output}`);
	return report;
}

export function evaluateNightlyRun(run, { maxAgeHours }, now = Date.now()) {
	if (run === undefined) return { passed: false, reason: 'No completed Nightly run was found.' };
	const completedAt = run.updated_at ?? run.created_at;
	const ageHours = completedAt === undefined ? Number.POSITIVE_INFINITY : (now - Date.parse(completedAt)) / 3_600_000;
	const passed = run.conclusion === 'success' && Number.isFinite(ageHours) && ageHours <= maxAgeHours;
	return {
		passed,
		conclusion: run.conclusion ?? null,
		runId: run.id ?? null,
		headSha: run.head_sha ?? null,
		completedAt: completedAt ?? null,
		ageHours: Number.isFinite(ageHours) ? Number(ageHours.toFixed(2)) : null,
		maxAgeHours,
		url: run.html_url ?? null,
		...(passed ? {} : { reason: run.conclusion !== 'success' ? `Latest Nightly concluded ${run.conclusion ?? 'unknown'}.` : `Latest Nightly is older than ${maxAgeHours} hours.` }),
	};
}

async function latestNightlyRun(policy) {
	const repository = process.env.GITHUB_REPOSITORY;
	const token = process.env.GITHUB_TOKEN;
	if (repository === undefined || token === undefined) {
		return { passed: false, reason: 'GITHUB_REPOSITORY and GITHUB_TOKEN are required to verify Nightly evidence.' };
	}
	const url = new URL(`https://api.github.com/repos/${repository}/actions/workflows/${policy.workflow}/runs`);
	url.searchParams.set('branch', policy.branch);
	url.searchParams.set('status', 'completed');
	url.searchParams.set('per_page', '1');
	const response = await fetch(url, {
		headers: {
			Accept: 'application/vnd.github+json',
			Authorization: `Bearer ${token}`,
			'X-GitHub-Api-Version': '2022-11-28',
		},
	});
	if (!response.ok) return { passed: false, reason: `GitHub Actions API returned ${response.status}.` };
	const payload = await response.json();
	return evaluateNightlyRun(payload.workflow_runs?.[0], policy);
}

function runCommand(command, cwd) {
	const executable = process.platform === 'win32' && command[0] === 'npm' ? 'npm.cmd' : command[0];
	const result = spawnSync(executable, command.slice(1), {
		cwd,
		env: process.env,
		encoding: 'utf8',
		maxBuffer: 64 * 1024 * 1024,
	});
	if (result.error !== undefined) throw result.error;
	if (result.stdout) process.stdout.write(result.stdout);
	if (result.stderr) process.stderr.write(result.stderr);
	const combined = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
	const outputTail = combined.split(/\r?\n/u).slice(-80).join('\n');
	return { status: result.status ?? 1, ...(outputTail.length === 0 ? {} : { outputTail }) };
}

function validatePolicy(policy) {
	if (policy.schemaVersion !== 1 || !Array.isArray(policy.checks) || !Array.isArray(policy.requirements)) throw new Error('Invalid stable release gate policy.');
	const ids = new Set();
	for (const check of policy.checks) {
		if (typeof check.id !== 'string' || !Array.isArray(check.command) || check.command.length === 0) throw new Error('Invalid stable release check.');
		if (ids.has(check.id)) throw new Error(`Duplicate stable release check: ${check.id}`);
		ids.add(check.id);
	}
	ids.add('nightly');
	for (const requirement of policy.requirements) {
		if (typeof requirement.id !== 'string' || !Array.isArray(requirement.evidence) || requirement.evidence.some(id => !ids.has(id))) throw new Error(`Invalid stable release requirement: ${requirement.id}`);
	}
}

const entry = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (entry === fileURLToPath(import.meta.url)) {
	const outputArgument = process.argv.find(argument => argument.startsWith('--output='));
	await runStableReleaseGate({ output: outputArgument === undefined ? undefined : resolve(outputArgument.slice('--output='.length)) });
}
