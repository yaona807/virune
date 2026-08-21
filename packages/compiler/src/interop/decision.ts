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
 * construct it through TypeScript. Unknown enum values, unknown fields, and
 * contradictory obligation state fail closed instead of being serialized as
 * successful evidence.
 */
export function canonicalizeInteropDecision(decision: InteropDecisionIR): InteropDecisionIR {
	assertExactRecordKeys(decision, DECISION_KEYS, 'Interop decision');
	assertKnown(DECISION_STATUSES, decision.status, 'decision status');
	assertKnown(MECHANISMS, decision.mechanism, 'Interop mechanism');
	assertKnown(AUTHORING_MODES, decision.authoring, 'Interop authoring mode');

	const claims = [...new Set(decision.claims.map(claim => {
		assertKnown(CLAIMS, claim, 'Interop safety claim');
		return claim;
	}))].sort(compareText);

	const obligationsByKey = new Map<string, InteropObligationIR>();
	for (const obligation of decision.obligations) {
		assertExactRecordKeys(obligation, OBLIGATION_KEYS, 'Interop obligation');
		assertKnown(OBLIGATION_KINDS, obligation.kind, 'Interop obligation kind');
		assertKnown(OBLIGATION_STAGES, obligation.stage, 'Interop obligation stage');
		assertKnown(OBLIGATION_STATUSES, obligation.status, 'Interop obligation status');
		const key = `${obligation.kind}\0${obligation.stage}`;
		const previous = obligationsByKey.get(key);
		if (previous !== undefined && previous.status !== obligation.status) {
			throw new Error(`Conflicting Interop obligation state for ${obligation.kind} at ${obligation.stage}`);
		}
		obligationsByKey.set(key, {
			kind: obligation.kind,
			stage: obligation.stage,
			status: obligation.status,
		});
	}
	const obligations = [...obligationsByKey.values()].sort((left, right) => compareText(
		`${left.kind}\0${left.stage}\0${left.status}`,
		`${right.kind}\0${right.stage}\0${right.status}`,
	));

	const hasPendingObligation = obligations.some(obligation => obligation.status === 'pending');
	if (decision.status === 'resolved' && hasPendingObligation) {
		throw new Error('Resolved Interop decision cannot retain pending obligations');
	}
	if (decision.status === 'obligation-pending' && !hasPendingObligation) {
		throw new Error('obligation-pending Interop decision requires at least one pending obligation');
	}

	return {
		status: decision.status,
		mechanism: decision.mechanism,
		authoring: decision.authoring,
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

function assertExactRecordKeys(value: unknown, expected: readonly string[], description: string): void {
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
}

function assertKnown<T extends string>(known: ReadonlySet<T>, value: T, description: string): void {
	if (!known.has(value)) throw new Error(`Unknown ${description}: ${String(value)}`);
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
