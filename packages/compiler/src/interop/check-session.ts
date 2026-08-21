import type * as A from '../ast/nodes.js';
import type { SemanticModel } from '../checker/checker.js';
import type { Diagnostic } from '../diagnostics/diagnostic.js';
import { checkedScopeWitness, currentCheckedBuiltinWitness } from '../session-witness.js';
import type {
	ForeignOrigin,
	ForeignTypeSnapshot,
	ForeignUsage,
	ForeignUsageIR,
	ModuleResolutionWitness,
	StableForeignTypeSnapshot,
} from './types.js';

interface CheckedSession {
	readonly checkerWitness: object;
	readonly moduleState: string;
	readonly evidenceState: string;
	readonly diagnostics: readonly Diagnostic[];
	readonly diagnosticsState: string;
}

const currentSessionByModule = new WeakMap<A.ModuleNode, CheckedSession>();
const sessionBySemantic = new WeakMap<object, CheckedSession>();

/** Invalidate any previously registered public semantic session for this AST object. */
export function invalidateCheckedSemantic(module: A.ModuleNode): void {
	currentSessionByModule.delete(module);
}

/** Bind one semantic result to the exact post-check AST, evidence, and compilation diagnostics. */
export function registerCheckedSemantic(
	module: A.ModuleNode,
	semantic: SemanticModel,
	diagnostics: readonly Diagnostic[] = semantic.diagnostics.items,
): void {
	const checkerWitness = checkedScopeWitness(semantic.globalScope);
	if (checkerWitness === undefined) throw new Error('Cannot register checked semantic without an untainted checker-owned scope witness');
	if (currentCheckedBuiltinWitness(module.span) !== checkerWitness) {
		throw new Error('Cannot re-register checked semantic after its checker witness has changed');
	}
	const registeredDiagnostics = Object.freeze([...diagnostics]);
	const session = Object.freeze({
		checkerWitness,
		moduleState: structuralState(module),
		evidenceState: checkedEvidenceState(semantic),
		diagnostics: registeredDiagnostics,
		diagnosticsState: structuralState(registeredDiagnostics),
	});
	currentSessionByModule.set(module, session);
	sessionBySemantic.set(semantic, session);
}

/**
 * A semantic result is current only while its object identity, checker witness,
 * post-check data, and the diagnostics registered for that exact compilation
 * remain unchanged.
 */
export function isCurrentCheckedSemantic(module: A.ModuleNode, semantic: SemanticModel): boolean {
	const session = sessionBySemantic.get(semantic);
	if (session === undefined || currentSessionByModule.get(module) !== session) return false;
	if (checkedScopeWitness(semantic.globalScope) !== session.checkerWitness) return false;
	if (currentCheckedBuiltinWitness(module.span) !== session.checkerWitness) return false;
	try {
		return session.moduleState === structuralState(module)
			&& session.evidenceState === checkedEvidenceState(semantic)
			&& session.diagnosticsState === structuralState(session.diagnostics);
	} catch {
		return false;
	}
}

/** Return the immutable diagnostic snapshot bound to the current checked session. */
export function currentCheckedDiagnostics(
	module: A.ModuleNode,
	semantic: SemanticModel,
): readonly Diagnostic[] | undefined {
	if (!isCurrentCheckedSemantic(module, semantic)) return undefined;
	return sessionBySemantic.get(semantic)?.diagnostics;
}

function checkedEvidenceState(semantic: SemanticModel): string {
	return structuralState({
		diagnostics: semantic.diagnostics.items,
		interop: checkedInteropEvidence(semantic),
	});
}

/**
 * Fingerprint only facts consumed by External Operation derivation.
 * Provider-private/navigation metadata is deliberately not enumerated: it is
 * neither stable evidence nor a session truth source.
 */
function checkedInteropEvidence(semantic: SemanticModel): unknown {
	return {
		usages: semantic.interop.usages
			.filter(usage => usage.kind !== 'import')
			.map(checkedUsageEvidence),
		usageIR: semantic.interop.usageIR.map(checkedUsageEvidence),
		moduleWitnesses: semantic.interop.moduleWitnesses.map(checkedModuleWitnessEvidence),
		requiresJavaScriptInitialization: semantic.interop.requiresJavaScriptInitialization,
	};
}

function checkedUsageEvidence(usage: ForeignUsage | ForeignUsageIR): unknown {
	const anchor = {
		kind: usage.kind,
		nodeId: usage.nodeId,
		span: checkedSpanEvidence(usage.span),
	};
	if (usage.kind === 'import') return anchor;
	return {
		...anchor,
		foreignType: checkedForeignTypeEvidence(usage.foreignType),
		...(usage.kind === 'call' ? { receiverMode: usage.receiverMode, mayReject: usage.mayReject } : {}),
		...(usage.kind === 'await' ? { mayReject: usage.mayReject } : {}),
		...(usage.kind === 'bridge' ? {
			bridge: usage.bridge === undefined ? undefined : {
				kind: usage.bridge.kind,
				bridge: usage.bridge.bridge,
			},
		} : {}),
	};
}

function checkedForeignTypeEvidence(snapshot: ForeignTypeSnapshot | StableForeignTypeSnapshot): unknown {
	return {
		category: snapshot.category,
		primitive: snapshot.primitive,
		mustUse: snapshot.mustUse,
		origin: snapshot.origin === undefined ? undefined : checkedOriginEvidence(snapshot.origin),
	};
}

function checkedOriginEvidence(origin: ForeignOrigin): unknown {
	return {
		moduleSpecifier: origin.moduleSpecifier,
		packageName: origin.packageName,
		packageVersion: origin.packageVersion,
		exportName: origin.exportName,
	};
}

function checkedModuleWitnessEvidence(witness: ModuleResolutionWitness): unknown {
	return {
		moduleSpecifier: witness.moduleSpecifier,
		packageName: witness.packageName,
		packageVersion: witness.packageVersion,
		runtimeEntry: witness.runtimeEntry,
		runtimeFormat: witness.runtimeFormat,
		conditions: [...new Set(witness.conditions)].sort(compareText),
		platform: witness.platform,
		packageJsonHash: witness.packageJsonHash,
	};
}

function checkedSpanEvidence(span: ForeignUsage['span']): unknown {
	return {
		fileId: span.fileId,
		start: { offset: span.start.offset, line: span.start.line, column: span.start.column },
		end: { offset: span.end.offset, line: span.end.line, column: span.end.column },
	};
}

function structuralState(value: unknown): string {
	return encodeStructuralValue(value, new Map<object, number>());
}

function encodeStructuralValue(value: unknown, seen: Map<object, number>): string {
	if (value === null) return 'null';
	if (value === undefined) return 'undefined';
	if (typeof value === 'string') return `string:${JSON.stringify(value)}`;
	if (typeof value === 'boolean') return value ? 'boolean:true' : 'boolean:false';
	if (typeof value === 'bigint') return `bigint:${value.toString(10)}`;
	if (typeof value === 'number') {
		if (Number.isNaN(value)) return 'number:NaN';
		if (value === Number.POSITIVE_INFINITY) return 'number:+Infinity';
		if (value === Number.NEGATIVE_INFINITY) return 'number:-Infinity';
		if (Object.is(value, -0)) return 'number:-0';
		return `number:${String(value)}`;
	}
	if (typeof value === 'function') return `function:${value.name}`;
	if (typeof value === 'symbol') return `symbol:${String(value.description ?? '')}`;
	if (typeof value !== 'object') return `${typeof value}:${String(value)}`;

	const existing = seen.get(value);
	if (existing !== undefined) return `reference:${existing}`;
	const id = seen.size;
	seen.set(value, id);

	if (Array.isArray(value)) {
		return `array:${id}:[${value.map(item => encodeStructuralValue(item, seen)).join(',')}]`;
	}
	const record = value as Record<string, unknown>;
	const keys = Object.keys(record).sort();
	return `object:${id}:{${keys.map(key => `${JSON.stringify(key)}=${encodeStructuralValue(record[key], seen)}`).join(',')}}`;
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
