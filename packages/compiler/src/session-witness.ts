import type { SourceSpan } from './source.js';

const currentBuiltinWitnessBySpan = new WeakMap<SourceSpan, object>();

/** Advance the checker-owned witness for a source-span identity without exposing it through SemanticModel data. */
export function registerCheckedBuiltinWitness(span: SourceSpan): void {
	currentBuiltinWitnessBySpan.set(span, Object.freeze({}));
}

/** Return the current opaque checker witness for one source-span identity. */
export function currentCheckedBuiltinWitness(span: SourceSpan): object | undefined {
	return currentBuiltinWitnessBySpan.get(span);
}
