import type * as A from '../ast/nodes.js';
import type { SemanticModel } from '../checker/checker.js';
import type { Diagnostic } from '../diagnostics/diagnostic.js';
import { buildExternalOperationSequence, type ExternalOperationIR } from './operation.js';

type ExternalOperationSnapshot =
	| { readonly status: 'valid'; readonly operations: readonly ExternalOperationIR[] }
	| { readonly status: 'invalid' };

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
