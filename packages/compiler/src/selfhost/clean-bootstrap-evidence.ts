import { createHash } from 'node:crypto';

export const CLEAN_BOOTSTRAP_EVIDENCE_VERSION = 1 as const;
export const REQUIRED_CLEAN_BOOTSTRAP_COMMANDS = [
	'install',
	'seed-verify',
	'bootstrap',
] as const;

export type CleanBootstrapCommandName = typeof REQUIRED_CLEAN_BOOTSTRAP_COMMANDS[number];
export type CleanBootstrapFailureCode =
	| 'CANDIDATE_MISMATCH'
	| 'COMMAND_FAILED'
	| 'DIRTY_WORKTREE'
	| 'MISSING_COMMAND'
	| 'NETWORK_NOT_OFFLINE'
	| 'SEED_MISMATCH'
	| 'SEED_NOT_VERIFIED'
	| 'STAGE_MISMATCH';

export interface CleanBootstrapCommandInput {
	readonly name: CleanBootstrapCommandName;
	readonly exitCode: number;
	readonly stdoutSha256: string;
	readonly stderrSha256: string;
}

export interface CleanBootstrapEvidenceInput {
	readonly version: typeof CLEAN_BOOTSTRAP_EVIDENCE_VERSION;
	readonly candidateSha256: string;
	readonly repositoryCommit: string;
	readonly checkedAt: string;
	readonly workingTreeClean: boolean;
	readonly networkMode: 'offline' | 'online';
	readonly lockfileSha256: string;
	readonly seed: {
		readonly manifestSha256: string;
		readonly artifactSha256: string;
		readonly verified: boolean;
	};
	readonly bootstrap: {
		readonly seedSha256: string;
		readonly stage1Sha256: string;
		readonly stage2Sha256: string;
		readonly equivalent: boolean;
	};
	readonly commands: readonly CleanBootstrapCommandInput[];
}

export interface CleanBootstrapFailure {
	readonly code: CleanBootstrapFailureCode;
	readonly path: string;
	readonly message: string;
}

export interface CleanBootstrapEvidenceReport {
	readonly version: typeof CLEAN_BOOTSTRAP_EVIDENCE_VERSION;
	readonly candidateSha256: string;
	readonly repositoryCommit: string;
	readonly checkedAt: string;
	readonly status: 'pass' | 'fail';
	readonly failures: readonly CleanBootstrapFailure[];
	readonly workingTreeClean: boolean;
	readonly networkMode: 'offline' | 'online';
	readonly lockfileSha256: string;
	readonly seed: CleanBootstrapEvidenceInput['seed'];
	readonly bootstrap: CleanBootstrapEvidenceInput['bootstrap'];
	readonly commands: readonly CleanBootstrapCommandInput[];
}

export interface CleanBootstrapGateEvidence {
	readonly name: 'clean-bootstrap';
	readonly candidateSha256: string;
	readonly checkedAt: string;
	readonly status: 'pass' | 'fail';
	readonly evidenceSha256: string;
}

export interface CleanBootstrapEvidenceResult {
	readonly report: CleanBootstrapEvidenceReport;
	readonly serialized: string;
	readonly sha256: string;
	readonly gate: CleanBootstrapGateEvidence;
}

/**
 * Validate host-collected clean-clone execution facts and produce a candidate-
 * bound rollback gate witness. Filesystem, process, clone, and network isolation
 * remain host responsibilities; this evaluator is deterministic and data-only.
 */
export function evaluateCleanBootstrapEvidence(value: unknown): CleanBootstrapEvidenceResult {
	const input = validateInput(value);
	const failures: CleanBootstrapFailure[] = [];
	if (!input.workingTreeClean) {
		fail(failures, 'DIRTY_WORKTREE', '$.workingTreeClean', 'The bootstrap checkout is not clean');
	}
	if (input.networkMode !== 'offline') {
		fail(failures, 'NETWORK_NOT_OFFLINE', '$.networkMode', 'The bootstrap run did not use offline mode');
	}
	if (!input.seed.verified) {
		fail(failures, 'SEED_NOT_VERIFIED', '$.seed.verified', 'The fixed Stage 0 seed was not verified');
	}
	if (input.seed.artifactSha256 !== input.bootstrap.seedSha256) {
		fail(
			failures,
			'SEED_MISMATCH',
			'$.bootstrap.seedSha256',
			'The bootstrap run did not use the verified Stage 0 seed artifact',
		);
	}
	if (
		!input.bootstrap.equivalent
		|| input.bootstrap.stage1Sha256 !== input.bootstrap.stage2Sha256
	) {
		fail(failures, 'STAGE_MISMATCH', '$.bootstrap', 'Stage 1 and Stage 2 artifacts are not equivalent');
	}
	if (input.candidateSha256 !== input.bootstrap.stage2Sha256) {
		fail(
			failures,
			'CANDIDATE_MISMATCH',
			'$.candidateSha256',
			'The clean bootstrap Stage 2 artifact does not match the candidate',
		);
	}
	const commandByName = new Map(input.commands.map(command => [command.name, command] as const));
	for (const name of REQUIRED_CLEAN_BOOTSTRAP_COMMANDS) {
		const command = commandByName.get(name);
		if (command === undefined) {
			fail(failures, 'MISSING_COMMAND', `$.commands.${name}`, `Required command ${name} is missing`);
		} else if (command.exitCode !== 0) {
			fail(failures, 'COMMAND_FAILED', `$.commands.${name}.exitCode`, `Required command ${name} failed`);
		}
	}
	const sortedFailures = failures.sort(compareFailure);
	const report: CleanBootstrapEvidenceReport = {
		version: CLEAN_BOOTSTRAP_EVIDENCE_VERSION,
		candidateSha256: input.candidateSha256,
		repositoryCommit: input.repositoryCommit,
		checkedAt: input.checkedAt,
		status: sortedFailures.length === 0 ? 'pass' : 'fail',
		failures: sortedFailures,
		workingTreeClean: input.workingTreeClean,
		networkMode: input.networkMode,
		lockfileSha256: input.lockfileSha256,
		seed: input.seed,
		bootstrap: input.bootstrap,
		commands: input.commands,
	};
	const serialized = JSON.stringify(report);
	const sha256 = hash(serialized);
	return {
		report,
		serialized,
		sha256,
		gate: {
			name: 'clean-bootstrap',
			candidateSha256: input.candidateSha256,
			checkedAt: input.checkedAt,
			status: report.status,
			evidenceSha256: sha256,
		},
	};
}

function validateInput(value: unknown): CleanBootstrapEvidenceInput {
	const input = record(value, '$');
	exactKeys(input, [
		'version',
		'candidateSha256',
		'repositoryCommit',
		'checkedAt',
		'workingTreeClean',
		'networkMode',
		'lockfileSha256',
		'seed',
		'bootstrap',
		'commands',
	], '$');
	if (input.version !== CLEAN_BOOTSTRAP_EVIDENCE_VERSION) throw new Error('$.version is invalid');
	const candidateSha256 = sha256Value(input.candidateSha256, '$.candidateSha256');
	const repositoryCommit = sha1Value(input.repositoryCommit, '$.repositoryCommit');
	const checkedAt = timestamp(input.checkedAt, '$.checkedAt');
	const workingTreeClean = boolean(input.workingTreeClean, '$.workingTreeClean');
	if (input.networkMode !== 'offline' && input.networkMode !== 'online') {
		throw new Error('$.networkMode must be offline or online');
	}
	const lockfileSha256 = sha256Value(input.lockfileSha256, '$.lockfileSha256');
	const seedValue = record(input.seed, '$.seed');
	exactKeys(seedValue, ['manifestSha256', 'artifactSha256', 'verified'], '$.seed');
	const seed = {
		manifestSha256: sha256Value(seedValue.manifestSha256, '$.seed.manifestSha256'),
		artifactSha256: sha256Value(seedValue.artifactSha256, '$.seed.artifactSha256'),
		verified: boolean(seedValue.verified, '$.seed.verified'),
	};
	const bootstrapValue = record(input.bootstrap, '$.bootstrap');
	exactKeys(bootstrapValue, ['seedSha256', 'stage1Sha256', 'stage2Sha256', 'equivalent'], '$.bootstrap');
	const bootstrap = {
		seedSha256: sha256Value(bootstrapValue.seedSha256, '$.bootstrap.seedSha256'),
		stage1Sha256: sha256Value(bootstrapValue.stage1Sha256, '$.bootstrap.stage1Sha256'),
		stage2Sha256: sha256Value(bootstrapValue.stage2Sha256, '$.bootstrap.stage2Sha256'),
		equivalent: boolean(bootstrapValue.equivalent, '$.bootstrap.equivalent'),
	};
	if (!Array.isArray(input.commands)) throw new Error('$.commands must be an array');
	const seen = new Set<CleanBootstrapCommandName>();
	const commands = input.commands.map((command, index) => {
		const path = `$.commands[${index}]`;
		const item = record(command, path);
		exactKeys(item, ['name', 'exitCode', 'stdoutSha256', 'stderrSha256'], path);
		if (!REQUIRED_CLEAN_BOOTSTRAP_COMMANDS.includes(item.name as CleanBootstrapCommandName)) {
			throw new Error(`${path}.name is invalid`);
		}
		const name = item.name as CleanBootstrapCommandName;
		if (seen.has(name)) throw new Error(`${path}.name is duplicated`);
		seen.add(name);
		return {
			name,
			exitCode: nonNegativeSafeInteger(item.exitCode, `${path}.exitCode`),
			stdoutSha256: sha256Value(item.stdoutSha256, `${path}.stdoutSha256`),
			stderrSha256: sha256Value(item.stderrSha256, `${path}.stderrSha256`),
		};
	}).sort((left, right) => compareText(left.name, right.name));
	return {
		version: CLEAN_BOOTSTRAP_EVIDENCE_VERSION,
		candidateSha256,
		repositoryCommit,
		checkedAt,
		workingTreeClean,
		networkMode: input.networkMode,
		lockfileSha256,
		seed,
		bootstrap,
		commands,
	};
}

function fail(
	failures: CleanBootstrapFailure[],
	code: CleanBootstrapFailureCode,
	path: string,
	message: string,
): void {
	failures.push({ code, path, message });
}

function record(value: unknown, path: string): Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path} must be a plain object`);
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) throw new Error(`${path} must be a plain object`);
	return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], path: string): void {
	const expected = new Set(keys);
	for (const key of Object.keys(value)) if (!expected.has(key)) throw new Error(`${path}.${key} is unknown`);
	for (const key of keys) if (!Object.hasOwn(value, key)) throw new Error(`${path}.${key} is missing`);
}

function boolean(value: unknown, path: string): boolean {
	if (typeof value !== 'boolean') throw new Error(`${path} must be a boolean`);
	return value;
}

function nonNegativeSafeInteger(value: unknown, path: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new Error(`${path} must be a non-negative safe integer`);
	}
	return value;
}

function sha1Value(value: unknown, path: string): string {
	if (typeof value !== 'string' || !/^[0-9a-f]{40}$/u.test(value)) {
		throw new Error(`${path} must be a lowercase Git commit SHA`);
	}
	return value;
}

function sha256Value(value: unknown, path: string): string {
	if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value)) {
		throw new Error(`${path} must be a lowercase SHA-256`);
	}
	return value;
}

function timestamp(value: unknown, path: string): string {
	if (typeof value !== 'string') throw new Error(`${path} must be a canonical UTC ISO timestamp`);
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
		throw new Error(`${path} must be a canonical UTC ISO timestamp`);
	}
	return value;
}

function compareFailure(left: CleanBootstrapFailure, right: CleanBootstrapFailure): number {
	return compareText(left.code, right.code) || compareText(left.path, right.path);
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function hash(value: string): string {
	return createHash('sha256').update(value, 'utf8').digest('hex');
}
