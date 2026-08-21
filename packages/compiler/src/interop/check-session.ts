import type * as A from '../ast/nodes.js';
import type { SemanticModel } from '../checker/checker.js';

const currentSessionByModule = new WeakMap<A.ModuleNode, object>();
const sessionBySemantic = new WeakMap<object, object>();

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

/** A previous semantic result becomes stale as soon as the same public AST object is checked again. */
export function isCurrentCheckedSemantic(module: A.ModuleNode, semantic: object): boolean {
	const session = sessionBySemantic.get(semantic);
	return session !== undefined && currentSessionByModule.get(module) === session;
}
