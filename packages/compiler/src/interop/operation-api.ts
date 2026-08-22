import type * as A from '../ast/nodes.js';
import type { SemanticModel } from '../checker/checker.js';
import type { Diagnostic } from '../diagnostics/diagnostic.js';
import { readDenseOwnDataArray, someArrayByIndex } from './array-safety.js';
import type { InteropSemanticModel } from './types.js';
import { currentCheckedDiagnostics, currentCheckedInterop } from './check-session.js';
import { externalOperationSequence as externalOperationSequenceFromEvidence, type ExternalOperationIR } from './operation.js';
import { isCurrentCheckedSourceIdentity } from './source-identity.js';

/**
 * Derive provider-independent External Operations from one checked semantic model.
 *
 * Keeping diagnostics and Interop evidence on the same exact registered check prevents
 * callers from substituting partial lookalike evidence. The SemanticModel must belong
 * to the current registered public session for this AST. Non-import operation anchors
 * must carry checker-owned inferred-type annotations.
 */
export function externalOperationSequence(input: {
	readonly module: A.ModuleNode;
	readonly semantic: SemanticModel;
}): readonly ExternalOperationIR[] {
	const evidence = assertCheckedAstEvidence(input.module, input.semantic);
	if (someArrayByIndex(input.semantic.diagnostics.items, diagnostic => diagnostic.severity === 'error')) return [];
	return externalOperationSequenceFromEvidence({
		module: input.module,
		interop: evidence.interop,
		diagnostics: evidence.diagnostics,
	});
}

function assertCheckedAstEvidence(
	module: A.ModuleNode,
	semantic: SemanticModel,
): { readonly diagnostics: readonly Diagnostic[]; readonly interop: InteropSemanticModel } {
	const diagnostics = currentCheckedDiagnostics(module, semantic);
	const interop = currentCheckedInterop(module, semantic);
	if (diagnostics === undefined || interop === undefined || !isCurrentCheckedSourceIdentity(module)) {
		throw new Error('Stale or cross-session External usage evidence: module is not from the current checked AST semantic session');
	}

	const inferredByNode = new Map<number, unknown>();
	const seen = new Set<object>();
	const visit = (value: unknown): void => {
		if (value === null || typeof value !== 'object' || seen.has(value)) return;
		seen.add(value);
		if (Array.isArray(value)) {
			const items = readDenseOwnDataArray(value, 'checked AST array');
			for (let index = 0; index < items.length; index++) visit(items[index]);
			return;
		}
		const record = value as Record<string, unknown>;
		const id = ownDataValue(record, 'id');
		if (typeof id === 'number' && Number.isSafeInteger(id)) {
			inferredByNode.set(id, ownDataValue(record, 'inferredTypeId'));
		}
		const keys = Reflect.ownKeys(record);
		for (let index = 0; index < keys.length; index++) {
			const key = keys[index]!;
			if (typeof key === 'symbol') throw new Error(`Checked AST contains symbol field ${String(key)}`);
			const descriptor = Object.getOwnPropertyDescriptor(record, key);
			if (descriptor === undefined || !('value' in descriptor)) throw new Error(`Checked AST field ${key} must be a data property`);
			visit(descriptor.value);
		}
	};
	visit(module);

	for (let index = 0; index < interop.usageIR.length; index++) {
		const usage = interop.usageIR[index]!;
		if (usage.kind === 'import') continue;
		const inferredTypeId = inferredByNode.get(usage.nodeId);
		if (typeof inferredTypeId !== 'number' || !Number.isSafeInteger(inferredTypeId)) {
			throw new Error(`Stale or cross-session External usage evidence: node ${usage.nodeId} is not from the checked AST`);
		}
	}
	return { diagnostics, interop };
}

function ownDataValue(record: Record<string, unknown>, key: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(record, key);
	return descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined;
}
