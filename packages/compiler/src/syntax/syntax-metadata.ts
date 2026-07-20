const syntaxStarts = new WeakMap<object, number>();

/**
 * Stores the actual CST start without changing the diagnostic/source-map span
 * already carried by the AST node. Documentation attachment consumes this
 * transient metadata immediately after AST construction.
 */
export function setSyntaxStart<T extends object>(node: T, offset: number): T {
	syntaxStarts.set(node, offset);
	return node;
}

export function syntaxStartOf(node: object): number | undefined {
	return syntaxStarts.get(node);
}
