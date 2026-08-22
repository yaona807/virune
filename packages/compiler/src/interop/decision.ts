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

/** Canonicalize provider-independent decision facts without treating JS object identity as a security boundary. */
export function canonicalizeInteropDecision(decision: InteropDecisionIR): InteropDecisionIR {
	assertRecord(decision, 'Interop decision');
	assertKnown(DECISION_STATUSES, decision.status, 'decision status');
	assertKnown(MECHANISMS, decision.mechanism, 'Interop mechanism');
	assertKnown(AUTHORING_MODES, decision.authoring, 'Interop authoring mode');
	if (!Array.isArray(decision.claims)) throw new Error('Interop decision claims must be an array');
	if (!Array.isArray(decision.obligations)) throw new Error('Interop decision obligations must be an array');

	const claims = [...new Set(decision.claims.map(claim => {
		assertKnown(CLAIMS, claim, 'Interop safety claim');
		return claim;
	}))].sort(compareText);
	const obligations: InteropObligationIR[] = [];
	for (const obligation of decision.obligations) {
		assertRecord(obligation, 'Interop obligation');
		assertKnown(OBLIGATION_KINDS, obligation.kind, 'Interop obligation kind');
		assertKnown(OBLIGATION_STAGES, obligation.stage, 'Interop obligation stage');
		assertKnown(OBLIGATION_STATUSES, obligation.status, 'Interop obligation status');
		const previous = obligations.find(item => item.kind === obligation.kind && item.stage === obligation.stage);
		if (previous !== undefined) {
			if (previous.status !== obligation.status) throw new Error(`Conflicting Interop obligation state for ${obligation.kind} at ${obligation.stage}`);
			continue;
		}
		obligations.push(freezeObligation({ kind: obligation.kind, stage: obligation.stage, status: obligation.status }));
	}
	obligations.sort((left, right) => compareText(`${left.kind}\0${left.stage}\0${left.status}`, `${right.kind}\0${right.stage}\0${right.status}`));

	const hasPending = obligations.some(obligation => obligation.status === 'pending');
	if (decision.status === 'resolved' && hasPending) throw new Error('Resolved Interop decision cannot retain pending obligations');
	if (decision.status === 'obligation-pending' && !hasPending) throw new Error('obligation-pending Interop decision requires at least one pending obligation');

	return Object.freeze({
		status: decision.status,
		mechanism: decision.mechanism,
		authoring: decision.authoring,
		claims: Object.freeze(claims),
		obligations: Object.freeze(obligations),
	});
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

function freezeObligation(obligation: InteropObligationIR): InteropObligationIR {
	return Object.freeze(obligation);
}

function assertRecord(value: unknown, description: string): asserts value is Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${description} must be a record`);
}

function assertKnown<T extends string>(known: readonly T[], value: unknown, description: string): asserts value is T {
	if (!known.includes(value as T)) throw new Error(`Unknown ${description}: ${String(value)}`);
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
