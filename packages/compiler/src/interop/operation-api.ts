import type * as A from '../ast/nodes.js';
import type { SemanticModel } from '../checker/checker.js';
import { externalOperationSequence as externalOperationSequenceFromEvidence, type ExternalOperationIR } from './operation.js';

/**
 * Derive provider-independent External Operations from one checked semantic model.
 *
 * Keeping diagnostics and Interop evidence on the same SemanticModel prevents a
 * caller from accidentally omitting checker failures while asking for Direct
 * operation evidence from that failed check.
 */
export function externalOperationSequence(input: {
	readonly module: A.ModuleNode;
	readonly semantic: Pick<SemanticModel, 'diagnostics' | 'interop'>;
}): readonly ExternalOperationIR[] {
	return externalOperationSequenceFromEvidence({
		module: input.module,
		interop: input.semantic.interop,
		diagnostics: input.semantic.diagnostics.items,
	});
}
