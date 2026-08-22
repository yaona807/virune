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

const DECISION_STATUSES = new Set<InteropDecisionStatus>(['resolved', 'obligation-pending', 'unresolved']);
const MECHANISMS = new Set<InteropMechanism>(['direct', 'callable-shim', 'managed', 'host', 'user-adapter', 'unsafe']);
const AUTHORING_MODES = new Set<InteropAuthoring>(['none', 'generated', 'user']);
const CLAIMS = new Set<InteropSafetyClaim>([
	'foreign-identity-preserved',
	'primitive-bridge-validated',
	'receiver-preserved',
	'type-boundary-safe',
]);
const OBLIGATION_KINDS = new Set<InteropObligationKind>(['runtime-resolution']);
const OBLIGATION_STAGES = new Set<InteropObligationStage>(['check', 'codegen', 'build', 'runtime']);
const OBLIGATION_STATUSES = new Set<InteropObligationStatus>(['pending', 'discharged']);
const DECISION_KEYS = ['status', 'mechanism', 'authoring', 'claims', 'obligations'] as const;
const OBLIGATION_KEYS = ['kind', 'stage', 'status'] as const;

/**
 * Canonicalize one provider-independent Interop decision.
 *
 * The input is treated as untrusted runtime data even though callers normally
 * construct it through TypeScript. Unknown enum values, unknown/accessor fields,
 * malformed arrays, and contradictory obligation state fail closed instead of
 * being serialized as successful evidence.
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
	const claims = [...new Set(claimValues.map(claim => {
		assertKnown(CLAIMS, claim, 'Interop safety claim');
		return claim;
	}))].sort(compareText);

	const obligationValues = readExactDataArray(decisionRecord.obligations, 'Interop decision obligations');
	const obligationsByKey = new Map<string, InteropObligationIR>();
	for (const obligation of obligationValues) {
		const obligationRecord = readExactDataRecord(obligation, OBLIGATION_KEYS, 'Interop obligation');
		const kind = obligationRecord.kind;
		const stage = obligationRecord.stage;
		const obligationStatus = obligationRecord.status;
		assertKnown(OBLIGATION_KINDS, kind, 'Interop obligation kind');
		assertKnown(OBLIGATION_STAGES, stage, 'Interop obligation stage');
		assertKnown(OBLIGATION_STATUSES, obligationStatus, 'Interop obligation status');
		const key = `${kind}\0${stage}`;
		const previous = obligationsByKey.get(key);
		if (previous !== undefined && previous.status !== obligationStatus) {
			throw new Error(`Conflicting Interop obligation state for ${kind} at ${stage}`);
		}
		obligationsByKey.set(key, {
			kind,
			stage,
			status: obligationStatus,
		});
	}
	const obligations = [...obligationsByKey.values()].sort((left, right) => compareText(
		`${left.kind}\0${left.stage}\0${left.status}`,
		`${right.kind}\0${right.stage}\0${right.status}`,
	));

	const hasPendingObligation = obligations.some(obligation => obligation.status === 'pending');
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
		obligations,
	};
}

/** Only fully resolved, non-authored Direct decisions with discharged obligations are success evidence. */
export function isResolvedDirectInteropDecision(decision: InteropDecisionIR): boolean {
	try {
		const canonical = canonicalizeInteropDecision(decision);
		return canonical.status === 'resolved'
			&& canonical.mechanism === 'direct'
			&& canonical.authoring === 'none'
			&& canonical.obligations.every(obligation => obligation.status === 'discharged');
	} catch {
		return false;
	}
}

function readExactDataRecord(value: unknown, expected: readonly string[], description: string): Readonly<Record<string, unknown>> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`${description} must be a plain record`);
	}
	const keys = Reflect.ownKeys(value);
	const symbolKey = keys.find((key): key is symbol => typeof key === 'symbol');
	if (symbolKey !== undefined) throw new Error(`Unknown ${description} field: ${String(symbolKey)}`);
	const actual = (keys as string[]).sort(compareText);
	const canonicalExpected = [...expected].sort(compareText);
	if (actual.length !== canonicalExpected.length || actual.some((key, index) => key !== canonicalExpected[index])) {
		const expectedSet = new Set(expected);
		const unknown = actual.filter(key => !expectedSet.has(key));
		if (unknown.length > 0) throw new Error(`Unknown ${description} field: ${unknown[0]}`);
		const actualSet = new Set(actual);
		const missing = canonicalExpected.find(key => !actualSet.has(key));
		throw new Error(`Missing ${description} field: ${String(missing)}`);
	}

	const snapshot: Record<string, unknown> = {};
	for (const key of canonicalExpected) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (descriptor === undefined) throw new Error(`Missing ${description} field: ${key}`);
		if (!('value' in descriptor)) throw new Error(`${description} field ${key} must be a data property`);
		snapshot[key] = descriptor.value;
	}
	return snapshot;
}

function readExactDataArray(value: unknown, description: string): readonly unknown[] {
	if (!Array.isArray(value)) throw new Error(`${description} must be an array`);
	const keys = Reflect.ownKeys(value);
	const symbolKey = keys.find((key): key is symbol => typeof key === 'symbol');
	if (symbolKey !== undefined) throw new Error(`Unknown ${description} field: ${String(symbolKey)}`);
	const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
	if (lengthDescriptor === undefined || !('value' in lengthDescriptor) || typeof lengthDescriptor.value !== 'number' || !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0) {
		throw new Error(`${description} has an invalid length`);
	}
	const length = lengthDescriptor.value;
	const indexKeys = (keys as string[]).filter(key => key !== 'length');
	if (indexKeys.length !== length) throw new Error(`${description} must be a dense array without extra fields`);
	const indexes = indexKeys.map(key => {
		const index = Number(key);
		if (!Number.isSafeInteger(index) || index < 0 || index >= length || String(index) !== key) {
			throw new Error(`Unknown ${description} field: ${key}`);
		}
		return index;
	}).sort((left, right) => left - right);
	if (indexes.some((index, position) => index !== position)) throw new Error(`${description} must be a dense array without extra fields`);

	const snapshot: unknown[] = [];
	for (const index of indexes) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (descriptor === undefined) throw new Error(`${description} is missing index ${index}`);
		if (!('value' in descriptor)) throw new Error(`${description} field ${index} must be a data property`);
		snapshot.push(descriptor.value);
	}
	return snapshot;
}

function assertKnown<T extends string>(known: ReadonlySet<T>, value: unknown, description: string): asserts value is T {
	if (!known.has(value as T)) throw new Error(`Unknown ${description}: ${String(value)}`);
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
