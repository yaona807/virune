import type * as A from '../ast/nodes.js';
import type { SemanticModel } from '../checker/checker.js';
import { isCurrentCheckedSemantic } from './check-session.js';
import { externalOperationSequence as externalOperationSequenceFromEvidence, type ExternalOperationIR } from './operation.js';

/**
 * Derive provider-independent External Operations from one checked semantic model.
 *
 * Keeping diagnostics and Interop evidence on the same SemanticModel prevents a
 * caller from accidentally omitting checker failures while asking for Direct
 * operation evidence from that failed check. The SemanticModel must also belong
 * to the current check session for this exact public AST object, and non-import
 * operation anchors must carry checker-owned inferred-type annotations.
 */
export function externalOperationSequence(input: {
	readonly module: A.ModuleNode;
	readonly semantic: Pick<SemanticModel, 'diagnostics' | 'interop'>;
}): readonly ExternalOperationIR[] {
	assertCheckedAstEvidence(input.module, input.semantic);
	return externalOperationSequenceFromEvidence({
		module: input.module,
		interop: input.semantic.interop,
		diagnostics: input.semantic.diagnostics.items,
	});
}

function assertCheckedAstEvidence(
	module: A.ModuleNode,
	semantic: Pick<SemanticModel, 'interop'>,
): void {
	if (!isCurrentCheckedSemantic(module, semantic)) {
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
}
