import type * as A from '../ast/nodes.js';
import type { SemanticModel } from '../checker/checker.js';

interface CheckedSourceIdentityState {
	readonly identities: readonly object[];
	readonly structuralState: string;
}

const currentStateByModule = new WeakMap<A.ModuleNode, CheckedSourceIdentityState>();
const stateBySemantic = new WeakMap<object, CheckedSourceIdentityState>();

/** Bind one checked semantic to the exact source graph it originally checked. */
export function registerCheckedSourceIdentity(module: A.ModuleNode, semantic: SemanticModel): void {
	const previous = stateBySemantic.get(semantic);
	if (previous !== undefined) {
		if (!matchesIdentity(module, previous.identities) || sourceStructuralState(module) !== previous.structuralState) {
			throw new Error('Cannot reuse checked semantic after its checked source graph changed');
		}
		currentStateByModule.set(module, previous);
		return;
	}
	const state = Object.freeze({
		identities: Object.freeze(captureIdentities(module)),
		structuralState: sourceStructuralState(module),
	});
	stateBySemantic.set(semantic, state);
	currentStateByModule.set(module, state);
}

/** Retire current authorization without forgetting the semantic's original checked source. */
export function invalidateCheckedSourceIdentity(module: A.ModuleNode): void {
	currentStateByModule.delete(module);
}

/**
 * Source data may be structurally unchanged while a nested object or array is
 * replaced by a Proxy that changes later property/iteration behavior. Require
 * both the original compiler-owned object graph and its checked data state.
 */
export function isCurrentCheckedSourceIdentity(module: A.ModuleNode): boolean {
	const state = currentStateByModule.get(module);
	if (state === undefined) return false;
	try {
		return matchesIdentity(module, state.identities)
			&& sourceStructuralState(module) === state.structuralState;
	} catch {
		return false;
	}
}

function captureIdentities(root: unknown): object[] {
	const identities: object[] = [];
	walkSourceObjects(root, value => {
		identities.push(value);
		return true;
	});
	return identities;
}

function matchesIdentity(root: unknown, expected: readonly object[]): boolean {
	let index = 0;
	const matches = walkSourceObjects(root, value => expected[index++] === value);
	return matches && index === expected.length;
}

function walkSourceObjects(root: unknown, visitor: (value: object) => boolean): boolean {
	const seen = new Set<object>();
	const visit = (value: unknown): boolean => {
		if (value === null || typeof value !== 'object' || seen.has(value)) return true;
		seen.add(value);
		if (!visitor(value)) return false;
		for (const child of sourceChildren(value)) {
			if (!visit(child)) return false;
		}
		return true;
	};
	return visit(root);
}

function sourceStructuralState(value: unknown): string {
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
	const children = sourceChildren(value);
	if (Array.isArray(value)) {
		return `array:${id}:[${children.map(child => encodeStructuralValue(child, seen)).join(',')}]`;
	}
	const fields = sourceStringKeys(value).map((key, index) => `${JSON.stringify(key)}=${encodeStructuralValue(children[index], seen)}`);
	return `object:${id}:{${fields.join(',')}}`;
}

function sourceChildren(value: object): readonly unknown[] {
	if (Array.isArray(value)) {
		if (Object.getPrototypeOf(value) !== Array.prototype) throw new Error('checked source array prototype changed');
		const keys = Reflect.ownKeys(value);
		if (keys.some(key => typeof key === 'symbol')) throw new Error('checked source array contains symbol field');
		const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
		if (lengthDescriptor === undefined || !('value' in lengthDescriptor) || typeof lengthDescriptor.value !== 'number' || !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0) {
			throw new Error('checked source array has invalid length');
		}
		const length = lengthDescriptor.value;
		const indexKeys = (keys as string[]).filter(key => key !== 'length');
		if (indexKeys.length !== length) throw new Error('checked source array must be dense without extra fields');
		return Array.from({ length }, (_, index) => {
			const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
			if (descriptor === undefined || !('value' in descriptor)) throw new Error(`checked source array index ${index} must be a data property`);
			return descriptor.value;
		});
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) throw new Error('checked source object prototype changed');
	return sourceStringKeys(value).map(key => {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (descriptor === undefined || !('value' in descriptor)) throw new Error(`checked source field ${key} must be a data property`);
		return descriptor.value;
	});
}

function sourceStringKeys(value: object): string[] {
	const keys = Reflect.ownKeys(value);
	const symbolKey = keys.find((key): key is symbol => typeof key === 'symbol');
	if (symbolKey !== undefined) throw new Error(`checked source object contains symbol field ${String(symbolKey)}`);
	return (keys as string[]).sort(compareText);
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
