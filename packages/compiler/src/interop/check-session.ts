import type * as A from '../ast/nodes.js';
import type { SemanticModel } from '../checker/checker.js';
import type { SourceSpan } from '../source.js';

const currentSessionByModule = new WeakMap<A.ModuleNode, object>();
const sessionBySemantic = new WeakMap<object, object>();
const currentBuiltinWitnessBySpan = new WeakMap<SourceSpan, object>();

/** Invalidate any previously registered public semantic session for this AST object. */
export function invalidateCheckedSemantic(module: A.ModuleNode): void {
	currentSessionByModule.delete(module);
}

/** Bind one semantic result to the exact public AST object for the current check session. */
export function registerCheckedSemantic(module: A.ModuleNode, semantic: SemanticModel): void {
	const session = Object.freeze({});
	currentSessionByModule.set(module, session);
	sessionBySemantic.set(semantic, session);
}

/** Record the newest checker-owned builtin object for a source-span identity. */
export function registerCheckedBuiltinWitness(span: SourceSpan, witness: object): void {
	currentBuiltinWitnessBySpan.set(span, witness);
}

/** A previous semantic result becomes stale as soon as the same public AST object is checked again. */
export function isCurrentCheckedSemantic(module: A.ModuleNode, semantic: object): boolean {
	const session = sessionBySemantic.get(semantic);
	return session !== undefined && currentSessionByModule.get(module) === session;
}

/** Require semantic symbols from the newest checker pass sharing this AST span identity. */
export function hasCurrentCheckedBuiltinWitness(
	module: A.ModuleNode,
	symbols: ReadonlyMap<unknown, unknown>,
): boolean {
	const witness = currentBuiltinWitnessBySpan.get(module.span);
	if (witness === undefined) return false;
	for (const symbol of symbols.values()) if (symbol === witness) return true;
	return false;
}
