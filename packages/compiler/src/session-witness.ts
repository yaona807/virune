import type { SourceSpan } from './source.js';

const currentCheckerWitnessBySpan = new WeakMap<SourceSpan, object>();
const checkerWitnessBySymbol = new WeakMap<object, object>();
const checkerWitnessByScope = new WeakMap<object, object>();
const taintedScopes = new WeakSet<object>();

/** Create one opaque identity shared by all builtin symbols from one checker instance. */
export function createCheckerWitness(): object {
	return Object.freeze({});
}

/** Record checker provenance without exposing the opaque witness through SemanticModel data. */
export function registerCheckedBuiltinWitness(span: SourceSpan, symbol: object, checkerWitness: object): void {
	currentCheckerWitnessBySpan.set(span, checkerWitness);
	checkerWitnessBySymbol.set(symbol, checkerWitness);
}

/** Bind an internal Scope object to the checker provenance of a builtin symbol. */
export function registerCheckedScopeWitness(scope: object, symbol: object): void {
	const checkerWitness = checkerWitnessBySymbol.get(symbol);
	if (checkerWitness === undefined) return;
	const existing = checkerWitnessByScope.get(scope);
	if (existing === undefined) checkerWitnessByScope.set(scope, checkerWitness);
	else if (existing !== checkerWitness) taintedScopes.add(scope);
}

/** Return the current opaque checker witness for one source-span identity. */
export function currentCheckedBuiltinWitness(span: SourceSpan): object | undefined {
	return currentCheckerWitnessBySpan.get(span);
}

/** Return immutable checker provenance for an untainted internal Scope identity. */
export function checkedScopeWitness(scope: object): object | undefined {
	if (taintedScopes.has(scope)) return undefined;
	return checkerWitnessByScope.get(scope);
}
