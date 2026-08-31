import { Err, Ok, makeRecord, makeVariant, type Result } from './core.js';
import { ViruneMap, ViruneSet } from './collections.js';

export interface JsError {
	readonly kind: 'JsError';
	readonly name: string;
	readonly message: string;
	readonly stack?: string;
	readonly cause?: unknown;
}

export interface DecodeBudget {
	readonly maxDepth: number;
	readonly maxNodes: number;
	readonly maxCollectionLength: number;
	readonly maxBytes: number;
}

export const defaultDecodeBudget: DecodeBudget = Object.freeze({
	maxDepth: 64,
	maxNodes: 100_000,
	maxCollectionLength: 100_000,
	maxBytes: 64 * 1024 * 1024,
});

export class ForeignContractError extends TypeError {
	public constructor(
		readonly path: string,
		readonly expected: string,
		readonly actual: string,
		message = `Foreign value at ${path} does not match ${expected}; received ${actual}`,
	) {
		super(message);
		this.name = 'ForeignContractError';
	}
}

export class ForeignDecodeError extends Error {
	public constructor(
		readonly path: string,
		readonly reason: string,
		override readonly cause?: unknown,
	) {
		super(`Cannot decode foreign value at ${path}: ${reason}`, cause === undefined ? undefined : { cause });
		this.name = 'ForeignDecodeError';
	}
}

export function toJsError(error: unknown): JsError {
	if (error instanceof Error) {
		return { kind: 'JsError', name: error.name, message: error.message, ...(error.stack === undefined ? {} : { stack: error.stack }), ...(error.cause === undefined ? {} : { cause: error.cause }) };
	}
	return { kind: 'JsError', name: 'Error', message: String(error) };
}

export function safeCall<T>(operation: () => T): Result<T, JsError> {
	try { return Ok(operation()); } catch (error) { return Err(toJsError(error)); }
}

export async function safeCallAsync<T>(operation: () => PromiseLike<T>): Promise<Result<T, JsError>> {
	try { return Ok(await operation()); } catch (error) { return Err(toJsError(error)); }
}

export function checkForeignString(value: unknown, path = '$'): string {
	if (typeof value === 'string') return value;
	throw contractError(path, 'String', value);
}

export function checkForeignBool(value: unknown, path = '$'): boolean {
	if (typeof value === 'boolean') return value;
	throw contractError(path, 'Bool', value);
}

export function checkForeignFloat(value: unknown, path = '$'): number {
	if (typeof value === 'number') return value;
	throw contractError(path, 'Float', value);
}

export function checkForeignBigInt(value: unknown, path = '$'): bigint {
	if (typeof value === 'bigint') return value;
	throw contractError(path, 'BigInt', value);
}

export function checkForeignInt(value: unknown, path = '$'): number {
	if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
	throw contractError(path, 'int', value);
}

function isMapIterable(value: unknown): value is Iterable<readonly [unknown, unknown]> {
	return value !== null && typeof value === 'object' && Symbol.iterator in value && (value instanceof Map || (value as { readonly $viruneCollection?: unknown }).$viruneCollection === 'Map');
}

function isSetIterable(value: unknown): value is Iterable<unknown> {
	return value !== null && typeof value === 'object' && Symbol.iterator in value && (value instanceof Set || (value as { readonly $viruneCollection?: unknown }).$viruneCollection === 'Set');
}

/**
 * Legacy helper kept for ABI compatibility. New interop code must preserve
 * foreign object identity and use an explicit codec when copying data.
 */
export function defensiveCopy(value: unknown): unknown {
	if (value instanceof Uint8Array) return value.slice();
	if (Array.isArray(value)) return value.map(defensiveCopy);
	if (isMapIterable(value)) return new Map([...value].map(([key, item]) => [defensiveCopy(key), defensiveCopy(item)]));
	if (isSetIterable(value)) return new Set([...value].map(defensiveCopy));
	if (isPlainDataObject(value)) {
		const target = Object.create(null) as Record<string, unknown>;
		for (const [key, item] of Object.entries(value)) defineDataProperty(target, key, defensiveCopy(item));
		return target;
	}
	return value;
}

export interface FfiRecordFieldDescriptor {
	readonly type: FfiTypeDescriptor;
	readonly jsonName?: string;
	readonly jsName?: string;
	readonly missingAsNone?: boolean;
	readonly omitWhenNone?: boolean;
	readonly hasDefault?: boolean;
	readonly defaultValue?: unknown;
}

export type FfiTypeDescriptor =
	| { readonly kind: 'unknown' }
	| { readonly kind: 'string' }
	| { readonly kind: 'bool' }
	| { readonly kind: 'int' }
	| { readonly kind: 'float' }
	| { readonly kind: 'bigint' }
	| { readonly kind: 'unit' }
	| { readonly kind: 'undefined' }
	| { readonly kind: 'null' }
	| { readonly kind: 'bytes' }
	| { readonly kind: 'list'; readonly item: FfiTypeDescriptor }
	| { readonly kind: 'tuple'; readonly items: readonly FfiTypeDescriptor[] }
	| { readonly kind: 'map'; readonly key: FfiTypeDescriptor; readonly value: FfiTypeDescriptor }
	| { readonly kind: 'set'; readonly item: FfiTypeDescriptor }
	| { readonly kind: 'option'; readonly value: FfiTypeDescriptor; readonly noneAs?: 'undefined' | 'null' | 'nullish' }
	| { readonly kind: 'result'; readonly value: FfiTypeDescriptor; readonly error: FfiTypeDescriptor }
	| { readonly kind: 'record'; readonly name: string; readonly typeId?: string; readonly fields: Readonly<Record<string, FfiTypeDescriptor | FfiRecordFieldDescriptor>>; readonly strict?: boolean; readonly allowClassInstance?: boolean }
	| { readonly kind: 'enum'; readonly name: string; readonly typeId?: string; readonly variants: Readonly<Record<string, readonly FfiTypeDescriptor[]>> };

function recordFieldType(field: FfiTypeDescriptor | FfiRecordFieldDescriptor): FfiTypeDescriptor {
	return 'type' in field ? field.type : field;
}

function recordFieldMetadata(field: FfiTypeDescriptor | FfiRecordFieldDescriptor): FfiRecordFieldDescriptor | undefined {
	return 'type' in field ? field : undefined;
}

interface TaggedValue {
	readonly $tag: string;
	readonly $values: readonly unknown[];
}

function isTaggedValue(value: unknown): value is TaggedValue {
	return value !== null && typeof value === 'object' && typeof (value as { $tag?: unknown }).$tag === 'string' && Array.isArray((value as { $values?: unknown }).$values);
}

interface DecodeState {
	readonly budget: DecodeBudget;
	readonly active: WeakSet<object>;
	nodes: number;
	bytes: number;
}

/** Converts a JavaScript value returned by an FFI function into Virune's runtime representation. */
export function validateFfiValue(value: unknown, descriptor: FfiTypeDescriptor, path = '$', budget: DecodeBudget = defaultDecodeBudget): unknown {
	return decodeValue(value, descriptor, path, 0, { budget, active: new WeakSet(), nodes: 0, bytes: 0 });
}

function decodeValue(value: unknown, descriptor: FfiTypeDescriptor, path: string, depth: number, state: DecodeState): unknown {
	consumeNode(state, path, depth);
	switch (descriptor.kind) {
		case 'unknown': return value;
		case 'string': return checkForeignString(value, path);
		case 'bool': return checkForeignBool(value, path);
		case 'int': return checkForeignInt(value, path);
		case 'float': return checkForeignFloat(value, path);
		case 'bigint': return checkForeignBigInt(value, path);
		case 'unit': return undefined;
		case 'undefined': if (value === undefined) return undefined; break;
		case 'null': if (value === null) return null; break;
		case 'bytes': {
			const bytes = copyBytes(value, path);
			state.bytes += bytes.byteLength;
			if (state.bytes > state.budget.maxBytes) throw new ForeignDecodeError(path, `byte budget ${state.budget.maxBytes} exceeded`);
			return bytes;
		}
		case 'list': {
			if (!Array.isArray(value)) break;
			ensureDenseArray(value, path, state.budget.maxCollectionLength);
			return withCycleGuard(value, path, state, () => value.map((item, index) => decodeValue(item, descriptor.item, `${path}[${index}]`, depth + 1, state)));
		}
		case 'tuple': {
			if (!Array.isArray(value) || value.length !== descriptor.items.length) break;
			ensureDenseArray(value, path, descriptor.items.length);
			return withCycleGuard(value, path, state, () => descriptor.items.map((item, index) => decodeValue(value[index], item, `${path}[${index}]`, depth + 1, state)));
		}
		case 'map': {
			if (!isMapIterable(value)) break;
			return withCycleGuard(value as object, path, state, () => {
				const entries = [...value];
				checkCollectionLength(entries.length, path, state.budget.maxCollectionLength);
				return new ViruneMap(entries.map(([key, item], index) => [decodeValue(key, descriptor.key, `${path}.key[${index}]`, depth + 1, state), decodeValue(item, descriptor.value, `${path}.value[${index}]`, depth + 1, state)]));
			});
		}
		case 'set': {
			if (!isSetIterable(value)) break;
			return withCycleGuard(value as object, path, state, () => {
				const entries = [...value];
				checkCollectionLength(entries.length, path, state.budget.maxCollectionLength);
				return new ViruneSet(entries.map((item, index) => decodeValue(item, descriptor.item, `${path}[${index}]`, depth + 1, state)));
			});
		}
		case 'option': {
			const noneAs = descriptor.noneAs ?? 'nullish';
			if ((noneAs === 'undefined' && value === undefined) || (noneAs === 'null' && value === null) || (noneAs === 'nullish' && (value === null || value === undefined))) return Object.freeze({ $tag: 'None', $values: [] });
			return makeVariant('Some', [decodeValue(value, descriptor.value, path, depth + 1, state)], 'std:Option');
		}
		case 'result': {
			if (isTaggedValue(value) && value.$tag === 'Ok' && value.$values.length === 1) return makeVariant('Ok', [decodeValue(value.$values[0], descriptor.value, `${path}.Ok`, depth + 1, state)], 'std:Result');
			if (isTaggedValue(value) && value.$tag === 'Err' && value.$values.length === 1) return makeVariant('Err', [decodeValue(value.$values[0], descriptor.error, `${path}.Err`, depth + 1, state)], 'std:Result');
			break;
		}
		case 'record': {
			if (!isRecordCandidate(value, descriptor.allowClassInstance === true)) break;
			return withCycleGuard(value, path, state, () => {
				const source = value as object;
				const output: Record<string, unknown> = Object.create(null);
				const expectedKeys = new Set<string>();
				for (const [name, field] of Object.entries(descriptor.fields)) {
					const metadata = recordFieldMetadata(field);
					const externalName = metadata?.jsName ?? name;
					expectedKeys.add(externalName);
					const property = readOwnDataProperty(source, externalName, `${path}.${externalName}`);
					if (!property.exists) {
						if (metadata?.missingAsNone === true && recordFieldType(field).kind === 'option') {
							defineDataProperty(output, name, makeVariant('None', [], 'std:Option'));
							continue;
						}
						throw new ForeignDecodeError(`${path}.${externalName}`, 'required own data property is missing');
					}
					defineDataProperty(output, name, decodeValue(property.value, recordFieldType(field), `${path}.${externalName}`, depth + 1, state));
				}
				if (descriptor.strict === true) {
					for (const key of Reflect.ownKeys(source)) if (typeof key === 'string' && !expectedKeys.has(key)) throw new ForeignDecodeError(`${path}.${key}`, 'unexpected property');
				}
				return makeRecord(output, descriptor.typeId ?? descriptor.name);
			});
		}
		case 'enum': {
			if (!isTaggedValue(value)) break;
			const fields = descriptor.variants[value.$tag];
			if (fields !== undefined && fields.length === value.$values.length) return makeVariant(value.$tag, fields.map((field, index) => decodeValue(value.$values[index], field, `${path}.${value.$tag}[${index}]`, depth + 1, state)), descriptor.typeId ?? descriptor.name);
			break;
		}
	}
	throw contractError(path, descriptor.kind, value);
}

/** Converts a Virune runtime value to a conventional JavaScript value before an FFI call. */
export function encodeFfiValue(value: unknown, descriptor: FfiTypeDescriptor): unknown {
	switch (descriptor.kind) {
		case 'unknown': case 'string': case 'bool': case 'int': case 'float': case 'bigint': return value;
		case 'unit': return undefined;
		case 'undefined': return undefined;
		case 'null': return null;
		case 'bytes': return value instanceof Uint8Array ? value.slice() : value;
		case 'list': return Array.isArray(value) ? value.map(item => encodeFfiValue(item, descriptor.item)) : value;
		case 'tuple': return Array.isArray(value) ? descriptor.items.map((item, index) => encodeFfiValue(value[index], item)) : value;
		case 'map': return isMapIterable(value) ? new Map([...value].map(([key, item]) => [encodeFfiValue(key, descriptor.key), encodeFfiValue(item, descriptor.value)])) : value;
		case 'set': return isSetIterable(value) ? new Set([...value].map(item => encodeFfiValue(item, descriptor.item))) : value;
		case 'option': {
			if (!isTaggedValue(value)) return value;
			if (value.$tag === 'None') return descriptor.noneAs === 'null' ? null : undefined;
			if (value.$tag === 'Some') return encodeFfiValue(value.$values[0], descriptor.value);
			return value;
		}
		case 'result': {
			if (!isTaggedValue(value)) return value;
			if (value.$tag === 'Ok') return { $tag: 'Ok', $values: [encodeFfiValue(value.$values[0], descriptor.value)] };
			if (value.$tag === 'Err') return { $tag: 'Err', $values: [encodeFfiValue(value.$values[0], descriptor.error)] };
			return value;
		}
		case 'record': {
			if (value === null || typeof value !== 'object') return value;
			const target: Record<string, unknown> = {};
			for (const [name, field] of Object.entries(descriptor.fields)) {
				const metadata = recordFieldMetadata(field);
				const property = readOwnDataProperty(value, name, `$.${name}`);
				if (!property.exists) continue;
				if (metadata?.omitWhenNone === true && isTaggedValue(property.value) && property.value.$tag === 'None') continue;
				defineDataProperty(target, metadata?.jsName ?? name, encodeFfiValue(property.value, recordFieldType(field)));
			}
			return target;
		}
		case 'enum': {
			if (!isTaggedValue(value)) return value;
			return { $tag: value.$tag, $values: (descriptor.variants[value.$tag] ?? []).map((field, index) => encodeFfiValue(value.$values[index], field)) };
		}
	}
}

function copyBytes(value: unknown, path: string): Uint8Array {
	if (value instanceof Uint8Array) return value.slice();
	if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
	if (ArrayBuffer.isView(value) && value.buffer instanceof ArrayBuffer) return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
	throw contractError(path, 'bytes', value);
}

function consumeNode(state: DecodeState, path: string, depth: number): void {
	if (depth > state.budget.maxDepth) throw new ForeignDecodeError(path, `maximum decode depth ${state.budget.maxDepth} exceeded`);
	state.nodes++;
	if (state.nodes > state.budget.maxNodes) throw new ForeignDecodeError(path, `node budget ${state.budget.maxNodes} exceeded`);
}

function checkCollectionLength(length: number, path: string, maximum: number): void {
	if (length > maximum) throw new ForeignDecodeError(path, `collection length ${length} exceeds ${maximum}`);
}

function ensureDenseArray(value: readonly unknown[], path: string, maximum: number): void {
	checkCollectionLength(value.length, path, maximum);
	for (let index = 0; index < value.length; index++) if (!Object.prototype.hasOwnProperty.call(value, index)) throw new ForeignDecodeError(`${path}[${index}]`, 'sparse arrays are not supported');
}

function withCycleGuard<T>(value: object, path: string, state: DecodeState, operation: () => T): T {
	if (state.active.has(value)) throw new ForeignDecodeError(path, 'cyclic value is not supported');
	state.active.add(value);
	try { return operation(); } catch (error) {
		if (error instanceof ForeignDecodeError || error instanceof ForeignContractError) throw error;
		throw new ForeignDecodeError(path, error instanceof Error ? error.message : String(error), error);
	} finally { state.active.delete(value); }
}

function readOwnDataProperty(value: object, key: string, path: string): { readonly exists: false } | { readonly exists: true; readonly value: unknown } {
	let descriptor: PropertyDescriptor | undefined;
	try { descriptor = Object.getOwnPropertyDescriptor(value, key); }
	catch (error) { throw new ForeignDecodeError(path, 'property descriptor access failed', error); }
	if (descriptor === undefined) return { exists: false };
	if ('get' in descriptor || 'set' in descriptor) throw new ForeignDecodeError(path, 'accessor properties are not accepted by the default decoder');
	return { exists: true, value: descriptor.value };
}

function isPlainDataObject(value: unknown): value is Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function isRecordCandidate(value: unknown, allowClassInstance: boolean): value is object {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
	return allowClassInstance || isPlainDataObject(value);
}

function defineDataProperty(target: object, key: PropertyKey, value: unknown): void {
	Object.defineProperty(target, key, { value, configurable: true, enumerable: true, writable: true });
}

function contractError(path: string, expected: string, value: unknown): ForeignContractError {
	return new ForeignContractError(path, expected, describeValue(value));
}

function describeValue(value: unknown): string {
	if (value === null) return 'null';
	if (Array.isArray(value)) return 'Array';
	if (value instanceof Uint8Array) return value.constructor.name;
	if (typeof value === 'object') return Object.getPrototypeOf(value)?.constructor?.name ?? 'Object';
	return typeof value;
}
