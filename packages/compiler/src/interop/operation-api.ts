import type * as A from '../ast/nodes.js';
import type { SemanticModel } from '../checker/checker.js';
import type { Diagnostic } from '../diagnostics/diagnostic.js';
import { buildExternalOperationSequence, type ExternalOperationIR } from './operation.js';

type ExternalOperationSnapshot =
	| { readonly status: 'valid'; readonly operations: readonly ExternalOperationIR[] }
	| { readonly status: 'invalid' };

export type ExternalExecutionReadinessBlocker =
	| { readonly reason: 'operation-evidence-unavailable' }
	| {
		readonly reason: 'runtime-resolution-pending' | 'runtime-resolution-unresolved';
		readonly moduleSpecifier: string;
	};

export type ExternalExecutionReadiness =
	| { readonly status: 'ready'; readonly blockers: readonly [] }
	| { readonly status: 'blocked'; readonly blockers: readonly ExternalExecutionReadinessBlocker[] };

const snapshots = new WeakMap<SemanticModel, ExternalOperationSnapshot>();

/**
 * Register one checked semantic result. Projection is deliberately non-authoritative:
 * malformed sidecar evidence makes the experimental API fail closed, but never
 * changes checker diagnostics, code generation, or project-cache behavior.
 */
export function registerExternalOperationSnapshot(
	module: A.ModuleNode,
	semantic: SemanticModel,
	diagnostics: readonly Diagnostic[] = semantic.diagnostics.items,
): void {
	if (snapshots.has(semantic)) return;
	try {
		const operations = buildExternalOperationSequence({ module, interop: semantic.interop, diagnostics });
		snapshots.set(semantic, Object.freeze({ status: 'valid', operations }));
	} catch {
		snapshots.set(semantic, Object.freeze({ status: 'invalid' }));
	}
}

/** Return immutable provider-independent operation evidence for this exact checked semantic result. */
export function externalOperationSequence(semantic: SemanticModel): readonly ExternalOperationIR[] {
	const snapshot = snapshots.get(semantic);
	if (snapshot === undefined) throw new Error('External Operation evidence requires a registered checked SemanticModel');
	if (snapshot.status === 'invalid') throw new Error('External Operation evidence is unavailable for this checked SemanticModel');
	return snapshot.operations;
}

/**
 * Determine whether one checked module is ready for direct execution.
 * Checking remains independent of this query; execution callers must consume it
 * before invoking emitted JavaScript.
 */
export function externalExecutionReadiness(semantic: SemanticModel): ExternalExecutionReadiness {
	const snapshot = snapshots.get(semantic);
	if (snapshot === undefined || snapshot.status === 'invalid') {
		return Object.freeze({
			status: 'blocked',
			blockers: Object.freeze([{ reason: 'operation-evidence-unavailable' as const }]),
		});
	}
	const blockers: ExternalExecutionReadinessBlocker[] = [];
	for (const operation of snapshot.operations) {
		if (operation.kind !== 'module-load') continue;
		const runtimeObligations = operation.decision.obligations.filter(obligation => obligation.kind === 'runtime-resolution');
		const allDischarged = runtimeObligations.length > 0 && runtimeObligations.every(obligation => obligation.status === 'discharged');
		if (operation.decision.status === 'resolved' && allDischarged) continue;
		blockers.push(Object.freeze({
			reason: runtimeObligations.some(obligation => obligation.status === 'pending')
				? 'runtime-resolution-pending'
				: 'runtime-resolution-unresolved',
			moduleSpecifier: operation.moduleSpecifier,
		}));
	}
	if (blockers.length === 0) return Object.freeze({ status: 'ready', blockers: Object.freeze([]) });
	return Object.freeze({ status: 'blocked', blockers: Object.freeze(blockers) });
}
