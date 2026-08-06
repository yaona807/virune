import { createHash } from 'node:crypto';

export const BOOTSTRAP_ROLLBACK_DECISION_VERSION = 1 as const;

export const REQUIRED_ROLLBACK_GATES = [
	'bootstrap-determinism',
	'legacy-compatibility',
	'runtime-behaviour',
	'performance',
	'clean-bootstrap',
	'rollback-smoke',
] as const;

export type RollbackGateName = typeof REQUIRED_ROLLBACK_GATES[number];

export interface RollbackGateEvidenceInput {
	readonly name: RollbackGateName;
	readonly candidateSha256: string;
	readonly checkedAt: string;
	readonly status: 'pass' | 'fail';
	readonly evidenceSha256: string;
}

export interface BootstrapRollbackDecisionInput {
	readonly version: typeof BOOTSTRAP_ROLLBACK_DECISION_VERSION;
	readonly candidateVersion: string;
	readonly candidateSha256: string;
	readonly releaseVersion: string;
	readonly evaluatedAt: string;
	readonly maximumEvidenceAgeSeconds: number;
	readonly gates: readonly RollbackGateEvidenceInput[];
}

export interface BootstrapRollbackReason {
	readonly gate: RollbackGateName;
	readonly code: 'FAILED' | 'FUTURE' | 'MISSING' | 'STALE' | 'SUBJECT_MISMATCH';
}

export interface BootstrapRollbackDecision {
	readonly version: typeof BOOTSTRAP_ROLLBACK_DECISION_VERSION;
	readonly candidateVersion: string;
	readonly candidateSha256: string;
	readonly releaseVersion: string;
	readonly selection: 'legacy' | 'self-host';
	readonly rollbackRequired: boolean;
	readonly reasons: readonly BootstrapRollbackReason[];
	readonly evaluatedGateEvidenceSha256: readonly string[];
}

export interface BootstrapRollbackDecisionResult {
	readonly decision: BootstrapRollbackDecision;
	readonly serialized: string;
	readonly sha256: string;
}

const sha256Pattern = /^[0-9a-f]{64}$/u;

export function evaluateBootstrapRollbackDecision(value: unknown): BootstrapRollbackDecisionResult {
	const input = validateInput(value);
	const evaluatedAt = Date.parse(input.evaluatedAt);
	const byName = new Map(input.gates.map(gate => [gate.name, gate] as const));
	const reasons: BootstrapRollbackReason[] = [];
	for (const gateName of REQUIRED_ROLLBACK_GATES) {
		const gate = byName.get(gateName);
		if (gate === undefined) {
			reasons.push({ gate: gateName, code: 'MISSING' });
			continue;
		}
		if (gate.candidateSha256 !== input.candidateSha256) {
			reasons.push({ gate: gateName, code: 'SUBJECT_MISMATCH' });
			continue;
		}
		const checkedAt = Date.parse(gate.checkedAt);
		if (checkedAt > evaluatedAt) {
			reasons.push({ gate: gateName, code: 'FUTURE' });
			continue;
		}
		if (evaluatedAt - checkedAt > input.maximumEvidenceAgeSeconds * 1000) {
			reasons.push({ gate: gateName, code: 'STALE' });
			continue;
		}
		if (gate.status === 'fail') reasons.push({ gate: gateName, code: 'FAILED' });
	}
	const sortedReasons = reasons.sort(compareReason);
	const decision: BootstrapRollbackDecision = {
		version: BOOTSTRAP_ROLLBACK_DECISION_VERSION,
		candidateVersion: input.candidateVersion,
		candidateSha256: input.candidateSha256,
		releaseVersion: input.releaseVersion,
		selection: sortedReasons.length === 0 ? 'self-host' : 'legacy',
		rollbackRequired: sortedReasons.length !== 0,
		reasons: sortedReasons,
		evaluatedGateEvidenceSha256: [...input.gates].sort(compareGate).map(gate => gate.evidenceSha256),
	};
	const serialized = JSON.stringify(decision);
	return { decision, serialized, sha256: sha256(serialized) };
}

function validateInput(value: unknown): BootstrapRollbackDecisionInput {
	const input = record(value, '$');
	exactKeys(input, ['version', 'candidateVersion', 'candidateSha256', 'releaseVersion', 'evaluatedAt', 'maximumEvidenceAgeSeconds', 'gates'], '$');
	if (input.version !== BOOTSTRAP_ROLLBACK_DECISION_VERSION) throw new Error('$.version is invalid');
	const candidateVersion = nonEmptyString(input.candidateVersion, '$.candidateVersion');
	const candidateSha256 = sha256Value(input.candidateSha256, '$.candidateSha256');
	const releaseVersion = nonEmptyString(input.releaseVersion, '$.releaseVersion');
	const evaluatedAt = timestamp(input.evaluatedAt, '$.evaluatedAt');
	const maximumEvidenceAgeSeconds = positiveSafeInteger(input.maximumEvidenceAgeSeconds, '$.maximumEvidenceAgeSeconds');
	const gateValues = array(input.gates, '$.gates');
	const gates = gateValues.map((gate, index) => validateGate(gate, `$.gates[${index}]`)).sort(compareGate);
	for (let index = 1; index < gates.length; index += 1) {
		if (gates[index - 1]!.name === gates[index]!.name) throw new Error(`$.gates[${index}].name is duplicated`);
	}
	return { version: 1, candidateVersion, candidateSha256, releaseVersion, evaluatedAt, maximumEvidenceAgeSeconds, gates };
}

function validateGate(value: unknown, path: string): RollbackGateEvidenceInput {
	const gate = record(value, path);
	exactKeys(gate, ['name', 'candidateSha256', 'checkedAt', 'status', 'evidenceSha256'], path);
	if (!REQUIRED_ROLLBACK_GATES.includes(gate.name as RollbackGateName)) throw new Error(`${path}.name is invalid`);
	if (gate.status !== 'pass' && gate.status !== 'fail') throw new Error(`${path}.status is invalid`);
	return {
		name: gate.name as RollbackGateName,
		candidateSha256: sha256Value(gate.candidateSha256, `${path}.candidateSha256`),
		checkedAt: timestamp(gate.checkedAt, `${path}.checkedAt`),
		status: gate.status,
		evidenceSha256: sha256Value(gate.evidenceSha256, `${path}.evidenceSha256`),
	};
}

function record(value: unknown, path: string): Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path} must be a plain object`);
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) throw new Error(`${path} must be a plain object`);
	return value as Record<string, unknown>;
}

function array(value: unknown, path: string): readonly unknown[] {
	if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
	return value;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], path: string): void {
	const expected = new Set(keys);
	for (const key of Object.keys(value)) if (!expected.has(key)) throw new Error(`${path}.${key} is unknown`);
	for (const key of keys) if (!Object.hasOwn(value, key)) throw new Error(`${path}.${key} is missing`);
}

function nonEmptyString(value: unknown, path: string): string {
	if (typeof value !== 'string' || value.length === 0) throw new Error(`${path} must be a non-empty string`);
	return value;
}

function sha256Value(value: unknown, path: string): string {
	const result = nonEmptyString(value, path);
	if (!sha256Pattern.test(result)) throw new Error(`${path} must be a lowercase SHA-256`);
	return result;
}

function timestamp(value: unknown, path: string): string {
	const result = nonEmptyString(value, path);
	const parsed = new Date(result);
	if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== result) {
		throw new Error(`${path} must be a canonical UTC ISO timestamp`);
	}
	return result;
}

function positiveSafeInteger(value: unknown, path: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new Error(`${path} must be a positive safe integer`);
	return value;
}

function compareGate(left: RollbackGateEvidenceInput, right: RollbackGateEvidenceInput): number {
	return compareText(left.name, right.name);
}

function compareReason(left: BootstrapRollbackReason, right: BootstrapRollbackReason): number {
	return compareText(left.gate, right.gate) || compareText(left.code, right.code);
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function sha256(value: string): string {
	return createHash('sha256').update(value, 'utf8').digest('hex');
}
