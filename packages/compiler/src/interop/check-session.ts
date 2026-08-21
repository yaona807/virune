import type * as A from '../ast/nodes.js';
import type { SemanticModel } from '../checker/checker.js';

interface CheckedSession {
	readonly moduleState: string;
	readonly evidenceState: string;
}

const currentSessionByModule = new WeakMap<A.ModuleNode, CheckedSession>();
const sessionBySemantic = new WeakMap<object, CheckedSession>();

/** Invalidate any previously registered public semantic session for this AST object. */
export function invalidateCheckedSemantic(module: A.ModuleNode): void {
	currentSessionByModule.delete(module);
}

/** Bind one semantic result to the exact post-check AST and evidence state. */
export function registerCheckedSemantic(module: A.ModuleNode, semantic: SemanticModel): void {
	const session = Object.freeze({
		moduleState: structuralState(module),
		evidenceState: checkedEvidenceState(semantic),
	});
	currentSessionByModule.set(module, session);
	sessionBySemantic.set(semantic, session);
}

/**
 * A semantic result is current only while both its object identity and the
 * operation-relevant post-check data remain unchanged.
 */
export function isCurrentCheckedSemantic(module: A.ModuleNode, semantic: SemanticModel): boolean {
	const session = sessionBySemantic.get(semantic);
	if (session === undefined || currentSessionByModule.get(module) !== session) return false;
	try {
		return session.moduleState === structuralState(module)
			&& session.evidenceState === checkedEvidenceState(semantic);
	} catch {
		return false;
	}
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
