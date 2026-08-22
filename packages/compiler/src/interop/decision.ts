import {
	copyArrayByIndex,
	everyArrayByIndex,
	mapArrayByIndex,
	readDenseOwnDataArray,
	someArrayByIndex,
	sortArrayByIndex,
	uniqueArrayByIndex,
} from './array-safety.js';

export type InteropDecisionStatus = 'resolved' | 'obligation-pending' | 'unresolved';

export type InteropMechanism = 'direct' | 'callable-shim' | 'managed' | 'host' | 'user-adapter' | 'unsafe';

export type InteropAuthoring = 'none' | 'generated' | 'user';

export type InteropSafetyClaim =
	| 'foreign-identity-preserved'
	| 'primitive-bridge-validated'
	| 'receiver-preserved'
	| 'type-boundary-safe';

export type InteropObligationKind = 'runtime-resolution';
export type InteropObligationStage = 'check' | 'codegen' | 'build' | 'runtime';
export type InteropObligationStatus = 'pending' | 'discharged';

export interface InteropObligationIR {
	readonly kind: InteropObligationKind;
	readonly stage: InteropObligationStage;
	readonly status: InteropObligationStatus;
}

export interface InteropDecisionIR {
	readonly status: InteropDecisionStatus;
	readonly mechanism: InteropMechanism;
	readonly authoring: InteropAuthoring;
	readonly claims: readonly InteropSafetyClaim[];
	readonly obligations: readonly InteropObligationIR[];
}

const DECISION_STATUSES: readonly InteropDecisionStatus[] = ['resolved', 'obligation-pending', 'unresolved'];
const MECHANISMS: readonly InteropMechanism[] = ['direct', 'callable-shim', 'managed', 'host', 'user-adapter', 'unsafe'];
const AUTHORING_MODES: readonly InteropAuthoring[] = ['none', 'generated', 'user'];
const CLAIMS: readonly InteropSafetyClaim[] = [
	'foreign-identity-preserved',
	'primitive-bridge-validated',
	'receiver-preserved',
	'type-boundary-safe',
];
const OBLIGATION_KINDS: readonly InteropObligationKind[] = ['runtime-resolution'];
const OBLIGATION_STAGES: readonly InteropObligationStage[] = ['check', 'codegen', 'build', 'runtime'];
const OBLIGATION_STATUSES: readonly InteropObligationStatus[] = ['pending', 'discharged'];
const DECISION_KEYS = ['status', 'mechanism', 'authoring', 'claims', 'obligations'] as const;
const OBLIGATION_KEYS = ['kind', 'stage', 'status'] as const;

/**
 * Canonicalize one provider-independent Interop decision.
 *
 * The input is treated as untrusted runtime data even though callers normally
 * construct it through TypeScript. Unknown enum values, unknown/accessor fields,
 * malformed arrays, and contradictory obligation state fail closed instead of
 * being serialized as successful evidence. Safety-critical array traversal and
 * enum membership use explicit indexes rather than inherited prototype hooks.
 */
export function canonicalizeInteropDecision(decision: InteropDecisionIR): InteropDecisionIR {
	const decisionRecord = readExactDataRecord(decision, DECISION_KEYS, 'Interop decision');
	const status = decisionRecord.status;
	const mechanism = decisionRecord.mechanism;
	const authoring = decisionRecord.authoring;
	assertKnown(DECISION_STATUSES, status, 'decision status');
	assertKnown(MECHANISMS, mechanism, 'Interop mechanism');
	assertKnown(AUTHORING_MODES, authoring, 'Interop authoring mode');

	const claimValues = readExactDataArray(decisionRecord.claims, 'Interop decision claims');
	const validatedClaims = mapArrayByIndex(claimValues, claim => {
		assertKnown(CLAIMS, claim, 'Interop safety claim');
		return claim;
	});
	const claims = sortArrayByIndex(uniqueArrayByIndex(validatedClaims), compareText);

	const obligationValues = readExactDataArray(decisionRecord.obligations, 'Interop decision obligations');
	const obligations: InteropObligationIR[] = [];
	for (let index = 0; index < obligationValues.length; index++) {
		const obligationRecord = readExactDataRecord(obligationValues[index], OBLIGATION_KEYS, 'Interop obligation');
		const kind = obligationRecord.kind;
		const stage = obligationRecord.stage;
		const obligationStatus = obligationRecord.status;
		assertKnown(OBLIGATION_KINDS, kind, 'Interop obligation kind');
		assertKnown(OBLIGATION_STAGES, stage, 'Interop obligation stage');
		assertKnown(OBLIGATION_STATUSES, obligationStatus, 'Interop obligation status');
		let duplicate = false;
		for (let candidate = 0; candidate < obligations.length; candidate++) {
			const previous = obligations[candidate]!;
			if (previous.kind !== kind || previous.stage !== stage) continue;
			if (previous.status !== obligationStatus) {
				throw new Error(`Conflicting Interop obligation state for ${kind} at ${stage}`);
			}
			duplicate = true;
			break;
		}
		if (!duplicate) obligations[obligations.length] = { kind, stage, status: obligationStatus };
	}
	const canonicalObligations = sortArrayByIndex(obligations, (left, right) => compareText(
		`${left.kind}\0${left.stage}\0${left.status}`,
		`${right.kind}\0${right.stage}\0${right.status}`,
	));

	const hasPendingObligation = someArrayByIndex(canonicalObligations, obligation => obligation.status === 'pending');
	if (status === 'resolved' && hasPendingObligation) {
		throw new Error('Resolved Interop decision cannot retain pending obligations');
	}
	if (status === 'obligation-pending' && !hasPendingObligation) {
		throw new Error('obligation-pending Interop decision requires at least one pending obligation');
	}

	return {
		status,
		mechanism,
		authoring,
		claims,
		obligations: canonicalObligations,
	};
}

/** Only fully resolved, non-authored Direct decisions with discharged obligations are success evidence. */
export function isResolvedDirectInteropDecision(decision: InteropDecisionIR): boolean {
	try {
		const canonical = canonicalizeInteropDecision(decision);
		return canonical.status === 'resolved'
			&& canonical.mechanism === 'direct'
			&& canonical.authoring === 'none'
			&& everyArrayByIndex(canonical.obligations, obligation => obligation.status === 'discharged');
	} catch {
		return false;
	}
}

function readExactDataRecord(value: unknown, expected: readonly string[], description: string): Readonly<Record<string, unknown>> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`${description} must be a plain record`);
	}
	const keys = Reflect.ownKeys(value);
	const actual: string[] = [];
	for (let index = 0; index < keys.length; index++) {
		const key = keys[index]!;
		if (typeof key === 'symbol') throw new Error(`Unknown ${description} field: ${String(key)}`);
		actual[actual.length] = key;
	}
	const canonicalActual = sortArrayByIndex(actual, compareText);
	const canonicalExpected = sortArrayByIndex(copyArrayByIndex(expected), compareText);
	let exact = canonicalActual.length === canonicalExpected.length;
	if (exact) {
		for (let index = 0; index < canonicalActual.length; index++) {
			if (canonicalActual[index] !== canonicalExpected[index]) {
				exact = false;
				break;
			}
		}
	}
	if (!exact) {
		for (let index = 0; index < canonicalActual.length; index++) {
			const key = canonicalActual[index]!;
			if (!containsText(canonicalExpected, key)) throw new Error(`Unknown ${description} field: ${key}`);
		}
		for (let index = 0; index < canonicalExpected.length; index++) {
			const key = canonicalExpected[index]!;
			if (!containsText(canonicalActual, key)) throw new Error(`Missing ${description} field: ${key}`);
		}
		throw new Error(`${description} fields do not match the canonical schema`);
	}

	const snapshot = Object.create(null) as Record<string, unknown>;
	for (let index = 0; index < canonicalExpected.length; index++) {
		const key = canonicalExpected[index]!;
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (descriptor === undefined) throw new Error(`Missing ${description} field: ${key}`);
		if (!('value' in descriptor)) throw new Error(`${description} field ${key} must be a data property`);
		Object.defineProperty(snapshot, key, {
			configurable: false,
			enumerable: true,
			writable: false,
			value: descriptor.value,
		});
	}
	return snapshot;
}

function readExactDataArray(value: unknown, description: string): readonly unknown[] {
	return readDenseOwnDataArray(value, description);
}

function containsText(values: readonly string[], expected: string): boolean {
	for (let index = 0; index < values.length; index++) if (values[index] === expected) return true;
	return false;
}

function assertKnown<T extends string>(known: readonly T[], value: unknown, description: string): asserts value is T {
	for (let index = 0; index < known.length; index++) {
		if (known[index] === value) return;
	}
	throw new Error(`Unknown ${description}: ${String(value)}`);
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
