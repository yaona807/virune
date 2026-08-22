import type * as A from '../ast/nodes.js';

const identityStateByModule = new WeakMap<A.ModuleNode, readonly object[]>();

/** Bind one checked AST to the exact compiler-owned object graph seen after checking. */
export function registerCheckedSourceIdentity(module: A.ModuleNode): void {
	const identities: object[] = [];
	if (!walkSourceObjects(module, value => {
		identities.push(value);
		return true;
	})) throw new Error('Cannot register checked source identity');
	identityStateByModule.set(module, Object.freeze(identities));
}

/** Drop an identity witness whenever the corresponding semantic session is invalidated. */
export function invalidateCheckedSourceIdentity(module: A.ModuleNode): void {
	identityStateByModule.delete(module);
}

/**
 * Source data may be structurally unchanged while a nested object or array is
 * replaced by a Proxy that changes later property/iteration behavior. Require
 * the exact compiler-owned object graph before any live AST traversal occurs.
 */
export function isCurrentCheckedSourceIdentity(module: A.ModuleNode): boolean {
	const expected = identityStateByModule.get(module);
	if (expected === undefined) return false;
	let index = 0;
	try {
		const matches = walkSourceObjects(module, value => expected[index++] === value);
		return matches && index === expected.length;
	} catch {
		return false;
	}
}

function walkSourceObjects(root: unknown, visitor: (value: object) => boolean): boolean {
	const seen = new Set<object>();
	const visit = (value: unknown): boolean => {
		if (value === null || typeof value !== 'object' || seen.has(value)) return true;
		seen.add(value);
		if (!visitor(value)) return false;

		const keys = Reflect.ownKeys(value);
		const symbolKey = keys.find((key): key is symbol => typeof key === 'symbol');
		if (symbolKey !== undefined) throw new Error(`checked source object contains symbol field ${String(symbolKey)}`);
		const stringKeys = (keys as string[]).sort(compareText);
		for (const key of stringKeys) {
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			if (descriptor === undefined) throw new Error(`checked source object is missing field ${key}`);
			if (!('value' in descriptor)) throw new Error(`checked source field ${key} must be a data property`);
			if (!visit(descriptor.value)) return false;
		}
		return true;
	};
	return visit(root);
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
