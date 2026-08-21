import type * as A from '../ast/nodes.js';
import type { SemanticModel } from '../checker/checker.js';
import type { Diagnostic } from '../diagnostics/diagnostic.js';
import { hasCurrentCheckedBuiltinWitness } from '../session-witness.js';
import { currentCheckedDiagnostics } from './check-session.js';
import { externalOperationSequence as externalOperationSequenceFromEvidence, type ExternalOperationIR } from './operation.js';

/**
 * Derive provider-independent External Operations from one checked semantic model.
 *
 * Keeping diagnostics and Interop evidence on the same exact registered check prevents
 * callers from substituting partial lookalike evidence. The SemanticModel must also
 * belong to the current registered public session for this AST and contain the newest
 * checker-owned builtin witness for the shared source-span identity. Non-import
 * operation anchors must carry checker-owned inferred-type annotations.
 */
export function externalOperationSequence(input: {
	readonly module: A.ModuleNode;
	readonly semantic: SemanticModel;
}): readonly ExternalOperationIR[] {
	const diagnostics = assertCheckedAstEvidence(input.module, input.semantic);
	return externalOperationSequenceFromEvidence({
		module: input.module,
		interop: input.semantic.interop,
		diagnostics,
	});
}

function assertCheckedAstEvidence(
	module: A.ModuleNode,
	semantic: SemanticModel,
): readonly Diagnostic[] {
	const diagnostics = currentCheckedDiagnostics(module, semantic);
	if (diagnostics === undefined || !hasCurrentCheckedBuiltinWitness(module.span, semantic.symbols)) {
		throw new Error('Stale or cross-session External usage evidence: module is not from the current checked AST semantic session');
	}

	const inferredByNode = new Map<number, unknown>();
	const seen = new Set<object>();
	const visit = (value: unknown): void => {
		if (value === null || typeof value !== 'object' || seen.has(value)) return;
		seen.add(value);
		if (Array.isArray(value)) {
			for (const item of value) visit(item);
			return;
		}
		const record = value as Record<string, unknown>;
		if (typeof record.id === 'number' && Number.isSafeInteger(record.id)) {
			inferredByNode.set(record.id, record.inferredTypeId);
		}
		for (const child of Object.values(record)) visit(child);
	};
	visit(module);

	for (const usage of semantic.interop.usageIR) {
		if (usage.kind === 'import') continue;
		const inferredTypeId = inferredByNode.get(usage.nodeId);
		if (typeof inferredTypeId !== 'number' || !Number.isSafeInteger(inferredTypeId)) {
			throw new Error(`Stale or cross-session External usage evidence: node ${usage.nodeId} is not from the checked AST`);
		}
	}
	return diagnostics;
}
