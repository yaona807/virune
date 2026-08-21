import type { SourceSpan } from './source.js';

const currentBuiltinWitnessBySpan = new WeakMap<SourceSpan, object>();

/** Record the newest checker-owned builtin object for a source-span identity. */
export function registerCheckedBuiltinWitness(span: SourceSpan, witness: object): void {
	currentBuiltinWitnessBySpan.set(span, witness);
}

/** Require symbols from the newest checker pass sharing this source-span identity. */
export function hasCurrentCheckedBuiltinWitness(
	span: SourceSpan,
	symbols: ReadonlyMap<unknown, unknown>,
): boolean {
	const witness = currentBuiltinWitnessBySpan.get(span);
	if (witness === undefined) return false;
	for (const symbol of symbols.values()) if (symbol === witness) return true;
	return false;
}
