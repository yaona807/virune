import type * as A from '../ast/nodes.js';
import type { SemanticModel } from '../checker/checker.js';
import type { Diagnostic } from '../diagnostics/diagnostic.js';
import { currentCheckedBuiltinWitness } from '../session-witness.js';

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
	const checkerWitness = currentCheckedBuiltinWitness(module.span);
	if (checkerWitness === undefined) throw new Error('Cannot register checked semantic without a checker-owned session witness');
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
		interop: semantic.interop,
	});
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
