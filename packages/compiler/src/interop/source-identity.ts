import type * as A from '../ast/nodes.js';
import type { SemanticModel } from '../checker/checker.js';

interface CheckedSourceIdentityState {
	readonly identities: readonly object[];
	readonly structuralState: string;
}

export interface CheckedSourceReuseSeal {
	readonly identities: readonly object[];
	readonly authoredState: string;
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

/**
 * Capture the source-authored graph state across one incremental recheck. The
 * checker may legitimately rewrite its own scalar annotations, so those fields
 * are excluded while source syntax, spans, node ids, object identities, and all
 * other own data remain sealed.
 */
export function captureCheckedSourceReuseSeal(module: A.ModuleNode): CheckedSourceReuseSeal {
	return Object.freeze({
		identities: Object.freeze(captureIdentities(module)),
		authoredState: sourceAuthoredState(module),
	});
}

export function matchesCheckedSourceReuseSeal(module: A.ModuleNode, seal: CheckedSourceReuseSeal): boolean {
	try {
		return matchesIdentity(module, seal.identities)
			&& sourceAuthoredState(module) === seal.authoredState;
	} catch {
		return false;
	}
}

function captureIdentities(root: unknown): object[] {
	const identities: object[] = [];
	walkSourceObjects(root, value => {
		identities[identities.length] = value;
		return true;
	});
	return identities;
}

function matchesIdentity(root: unknown, expected: readonly object[]): boolean {
	let index = 0;
	const matches = walkSourceObjects(root, value => {
		const same = expected[index] === value;
		index++;
		return same;
	});
	return matches && index === expected.length;
}

/**
 * Traverse compiler-owned source data without inherited collection helpers or
 * iteration. Currentness must not depend on mutable prototype behavior.
 */
function walkSourceObjects(root: unknown, visitor: (value: object) => boolean): boolean {
	const seen: object[] = [];
	const visit = (value: unknown): boolean => {
		if (value === null || typeof value !== 'object') return true;
		for (let index = 0; index < seen.length; index++) {
			if (seen[index] === value) return true;
		}
		seen[seen.length] = value;
		if (!visitor(value)) return false;
		const children = sourceChildren(value);
		for (let index = 0; index < children.length; index++) {
			if (!visit(children[index])) return false;
		}
		return true;
	};
	return visit(root);
}

function sourceStructuralState(value: unknown): string {
	return encodeStructuralValue(value, new Map<object, number>());
}

function sourceAuthoredState(value: unknown): string {
	return encodeAuthoredValue(value, new Map<object, number>());
}

function encodeStructuralValue(value: unknown, seen: Map<object, number>): string {
	if (value === null) return 'null';
	if (value === undefined) return 'undefined';
	if (typeof value === 'string') return `string:${value.length}:${value}`;
	if (typeof value === 'boolean') return value ? 'boolean:true' : 'boolean:false';
	if (typeof value === 'bigint') return `bigint:${value}`;
	if (typeof value === 'number') {
		if (Number.isNaN(value)) return 'number:NaN';
		if (value === Number.POSITIVE_INFINITY) return 'number:+Infinity';
		if (value === Number.NEGATIVE_INFINITY) return 'number:-Infinity';
		if (Object.is(value, -0)) return 'number:-0';
		return `number:${value}`;
	}
	if (typeof value === 'function') return `function:${value.name.length}:${value.name}`;
	if (typeof value === 'symbol') {
		const description = value.description ?? '';
		return `symbol:${description.length}:${description}`;
	}
	if (typeof value !== 'object') return `${typeof value}:${String(value)}`;

	const existing = seen.get(value);
	if (existing !== undefined) return `reference:${existing}`;
	const id = seen.size;
	seen.set(value, id);
	const children = sourceChildren(value);
	if (Array.isArray(value)) {
		let encodedItems = '';
		for (let index = 0; index < children.length; index++) {
			if (index > 0) encodedItems += ',';
			encodedItems += encodeStructuralValue(children[index], seen);
		}
		return `array:${id}:[${encodedItems}]`;
	}
	const keys = sourceStringKeys(value);
	if (keys.length !== children.length) throw new Error('checked source object keys changed while encoding');
	let encodedFields = '';
	for (let index = 0; index < keys.length; index++) {
		const key = keys[index]!;
		if (index > 0) encodedFields += ',';
		encodedFields += `${key.length}:${key}=${encodeStructuralValue(children[index], seen)}`;
	}
	return `object:${id}:{${encodedFields}}`;
}

function encodeAuthoredValue(value: unknown, seen: Map<object, number>): string {
	if (value === null) return 'null';
	if (value === undefined) return 'undefined';
	if (typeof value === 'string') return `string:${value.length}:${value}`;
	if (typeof value === 'boolean') return value ? 'boolean:true' : 'boolean:false';
	if (typeof value === 'bigint') return `bigint:${value}`;
	if (typeof value === 'number') {
		if (Number.isNaN(value)) return 'number:NaN';
		if (value === Number.POSITIVE_INFINITY) return 'number:+Infinity';
		if (value === Number.NEGATIVE_INFINITY) return 'number:-Infinity';
		if (Object.is(value, -0)) return 'number:-0';
		return `number:${value}`;
	}
	if (typeof value === 'function') return `function:${value.name.length}:${value.name}`;
	if (typeof value === 'symbol') {
		const description = value.description ?? '';
		return `symbol:${description.length}:${description}`;
	}
	if (typeof value !== 'object') return `${typeof value}:${String(value)}`;

	const existing = seen.get(value);
	if (existing !== undefined) return `reference:${existing}`;
	const id = seen.size;
	seen.set(value, id);

	if (Array.isArray(value)) {
		const children = sourceChildren(value);
		let encodedItems = '';
		for (let index = 0; index < children.length; index++) {
			if (index > 0) encodedItems += ',';
			encodedItems += encodeAuthoredValue(children[index], seen);
		}
		return `array:${id}:[${encodedItems}]`;
	}

	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) throw new Error('checked source object prototype changed');
	const keys = sourceStringKeys(value);
	let encodedFields = '';
	let fieldIndex = 0;
	for (let index = 0; index < keys.length; index++) {
		const key = keys[index]!;
		if (isCheckerDerivedField(key)) continue;
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (descriptor === undefined || !('value' in descriptor)) throw new Error(`checked source field ${key} must be a data property`);
		if (fieldIndex > 0) encodedFields += ',';
		encodedFields += `${key.length}:${key}=${encodeAuthoredValue(descriptor.value, seen)}`;
		fieldIndex++;
	}
	return `object:${id}:{${encodedFields}}`;
}

function sourceChildren(value: object): readonly unknown[] {
	if (Array.isArray(value)) {
		if (Object.getPrototypeOf(value) !== Array.prototype) throw new Error('checked source array prototype changed');
		const keys = Reflect.ownKeys(value);
		const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
		if (
			lengthDescriptor === undefined
			|| !('value' in lengthDescriptor)
			|| typeof lengthDescriptor.value !== 'number'
			|| !Number.isSafeInteger(lengthDescriptor.value)
			|| lengthDescriptor.value < 0
		) {
			throw new Error('checked source array has invalid length');
		}
		const length = lengthDescriptor.value;
		let indexKeyCount = 0;
		for (let keyIndex = 0; keyIndex < keys.length; keyIndex++) {
			const key = keys[keyIndex]!;
			if (typeof key === 'symbol') throw new Error('checked source array contains symbol field');
			if (key === 'length') continue;
			const index = Number(key);
			if (!Number.isSafeInteger(index) || index < 0 || index >= length || `${index}` !== key) {
				throw new Error(`checked source array contains unknown field ${key}`);
			}
			indexKeyCount++;
		}
		if (indexKeyCount !== length) throw new Error('checked source array must be dense without extra fields');
		const children: unknown[] = new Array<unknown>(length);
		for (let index = 0; index < length; index++) {
			const descriptor = Object.getOwnPropertyDescriptor(value, `${index}`);
			if (descriptor === undefined || !('value' in descriptor)) throw new Error(`checked source array index ${index} must be a data property`);
			children[index] = descriptor.value;
		}
		return children;
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) throw new Error('checked source object prototype changed');
	const keys = sourceStringKeys(value);
	const children: unknown[] = new Array<unknown>(keys.length);
	for (let index = 0; index < keys.length; index++) {
		const key = keys[index]!;
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (descriptor === undefined || !('value' in descriptor)) throw new Error(`checked source field ${key} must be a data property`);
		children[index] = descriptor.value;
	}
	return children;
}

function sourceStringKeys(value: object): string[] {
	const keys = Reflect.ownKeys(value);
	const result: string[] = [];
	for (let index = 0; index < keys.length; index++) {
		const key = keys[index]!;
		if (typeof key === 'symbol') throw new Error(`checked source object contains symbol field ${String(key)}`);
		result[result.length] = key;
	}
	return result;
}

function isCheckerDerivedField(key: string): boolean {
	switch (key) {
		case 'foreignBridge':
		case 'foreignCall':
		case 'inferredTypeId':
		case 'resolvedTypeId':
		case 'symbolId':
		case 'targetSymbolId':
			return true;
		default:
			return false;
	}
}
