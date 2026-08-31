import { Err, Ok, type Result } from './core.js';
import {
	ForeignContractError,
	ForeignDecodeError,
	defaultDecodeBudget,
	encodeFfiValue as legacyEncodeFfiValue,
	safeCallAsync as legacySafeCallAsync,
	toJsError as legacyToJsError,
	validateFfiValue as legacyValidateFfiValue,
	type DecodeBudget,
	type FfiTypeDescriptor,
	type JsError,
} from './ffi.js';

interface SafeFfiEnvelope {
	readonly version: 'virune-safe-ffi/v1';
	readonly type: FfiTypeDescriptor;
}

interface TaggedValue {
	readonly $tag: string;
	readonly $values: readonly unknown[];
}

const foreignUnknownObjects = new WeakSet<object>();
const maximumSafeDescriptorDepth = 64;

function safeEnvelope(descriptor: FfiTypeDescriptor): SafeFfiEnvelope | undefined {
	const candidate = descriptor as unknown;
	if (candidate === null || typeof candidate !== 'object') throw new ForeignDecodeError('$descriptor', 'FFI descriptor must be an object');
	const record = candidate as Record<string, unknown>;
	if (Object.hasOwn(record, 'kind')) {
		if (Object.hasOwn(record, 'version')) throw new ForeignDecodeError('$descriptor', 'legacy FFI descriptor must not carry Safe FFI envelope version metadata');
		return undefined;
	}
	try {
		if (
			record.version !== 'virune-safe-ffi/v1'
			|| !hasExactKeys(record, ['type', 'version'])
			|| !isCanonicalFfiDescriptor(record.type)
		) throw new ForeignDecodeError('$descriptor', 'unsupported, stale, partial, or malformed Safe FFI envelope');
		return record as unknown as SafeFfiEnvelope;
	} catch (error) {
		if (error instanceof ForeignDecodeError) throw error;
		throw new ForeignDecodeError('$descriptor', 'Safe FFI envelope inspection failed', error);
	}
}

function isCanonicalFfiDescriptor(value: unknown, active = new WeakSet<object>(), depth = 0): value is FfiTypeDescriptor {
	if (!isRecord(value) || depth > maximumSafeDescriptorDepth || active.has(value)) return false;
	active.add(value);
	try {
		const kind = value.kind;
		if (typeof kind !== 'string') return false;
		switch (kind) {
			case 'unknown': case 'string': case 'bool': case 'int': case 'float': case 'bigint': case 'unit': case 'undefined': case 'null': case 'bytes':
				return hasExactKeys(value, ['kind']);
			case 'list':
				return hasExactKeys(value, ['item', 'kind']) && isCanonicalFfiDescriptor(value.item, active, depth + 1);
			case 'tuple':
				return hasExactKeys(value, ['items', 'kind']) && isCanonicalDescriptorArray(value.items, item => isCanonicalFfiDescriptor(item, active, depth + 1));
			case 'map':
				return hasExactKeys(value, ['key', 'kind', 'value']) && isCanonicalFfiDescriptor(value.key, active, depth + 1) && isCanonicalFfiDescriptor(value.value, active, depth + 1);
			case 'set':
				return hasExactKeys(value, ['item', 'kind']) && isCanonicalFfiDescriptor(value.item, active, depth + 1);
			case 'option':
				return hasKnownKeys(value, ['kind', 'value'], ['noneAs'])
					&& isCanonicalFfiDescriptor(value.value, active, depth + 1)
					&& (value.noneAs === undefined || value.noneAs === 'undefined' || value.noneAs === 'null' || value.noneAs === 'nullish');
			case 'result':
				return hasExactKeys(value, ['error', 'kind', 'value'])
					&& isCanonicalFfiDescriptor(value.value, active, depth + 1)
					&& isCanonicalFfiDescriptor(value.error, active, depth + 1);
			case 'record': {
				if (!hasKnownKeys(value, ['fields', 'kind', 'name'], ['allowClassInstance', 'strict', 'typeId'])) return false;
				if (typeof value.name !== 'string' || value.name.length === 0 || !isCanonicalDescriptorMap(value.fields)) return false;
				if (value.typeId !== undefined && typeof value.typeId !== 'string') return false;
				if (value.strict !== undefined && typeof value.strict !== 'boolean') return false;
				if (value.allowClassInstance !== undefined && typeof value.allowClassInstance !== 'boolean') return false;
				return Object.values(value.fields).every(field => isCanonicalRecordField(field, active, depth + 1));
			}
			case 'enum': {
				if (!hasKnownKeys(value, ['kind', 'name', 'variants'], ['typeId'])) return false;
				if (typeof value.name !== 'string' || value.name.length === 0 || !isCanonicalDescriptorMap(value.variants)) return false;
				if (value.typeId !== undefined && typeof value.typeId !== 'string') return false;
				return Object.values(value.variants).every(fields => isCanonicalDescriptorArray(fields, field => isCanonicalFfiDescriptor(field, active, depth + 1)));
			}
			default: return false;
		}
	} finally {
		active.delete(value);
	}
}

function isCanonicalRecordField(value: unknown, active: WeakSet<object>, depth: number): boolean {
	if (!isRecord(value)) return false;
	if (!Object.hasOwn(value, 'type')) return isCanonicalFfiDescriptor(value, active, depth);
	if (!hasKnownKeys(value, ['type'], ['defaultValue', 'hasDefault', 'jsName', 'jsonName', 'missingAsNone', 'omitWhenNone'])) return false;
	if (!isCanonicalFfiDescriptor(value.type, active, depth)) return false;
	if (value.jsName !== undefined && typeof value.jsName !== 'string') return false;
	if (value.jsonName !== undefined && typeof value.jsonName !== 'string') return false;
	const hasDefault = Object.hasOwn(value, 'hasDefault');
	const hasDefaultValue = Object.hasOwn(value, 'defaultValue');
	if (hasDefault !== hasDefaultValue || hasDefault && value.hasDefault !== true) return false;
	const missingAsNone = Object.hasOwn(value, 'missingAsNone');
	const omitWhenNone = Object.hasOwn(value, 'omitWhenNone');
	if (missingAsNone !== omitWhenNone) return false;
	if (missingAsNone && (value.missingAsNone !== true || value.omitWhenNone !== true)) return false;
	return true;
}

function isCanonicalDescriptorArray(value: unknown, validate: (item: unknown) => boolean): value is readonly unknown[] {
	if (!Array.isArray(value)) return false;
	const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
	if (lengthDescriptor === undefined || !('value' in lengthDescriptor) || typeof lengthDescriptor.value !== 'number') return false;
	const length = lengthDescriptor.value;
	if (Reflect.ownKeys(value).length !== length + 1) return false;
	for (let index = 0; index < length; index++) {
		const item = Object.getOwnPropertyDescriptor(value, String(index));
		if (item === undefined || !('value' in item) || !validate(item.value)) return false;
	}
	return true;
}

function isCanonicalDescriptorMap(value: unknown): value is Record<string, unknown> {
	if (!isRecord(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) return false;
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== 'string') return false;
		const property = Object.getOwnPropertyDescriptor(value, key);
		if (property === undefined || !('value' in property)) return false;
	}
	return true;
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
	return hasKnownKeys(value, expected, []);
}

function hasKnownKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[]): boolean {
	const allowed = new Set([...required, ...optional]);
	const keys = Reflect.ownKeys(value);
	return required.every(key => Object.hasOwn(value, key))
		&& keys.every(key => {
			if (typeof key !== 'string' || !allowed.has(key)) return false;
			const property = Object.getOwnPropertyDescriptor(value, key);
			return property !== undefined && 'value' in property;
		});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isIdentityBearing(value: unknown): value is object {
	return value !== null && (typeof value === 'object' || typeof value === 'function');
}

function safeUnknownInbound(value: unknown): void {
	if (isIdentityBearing(value)) foreignUnknownObjects.add(value);
}

function safeUnknownOutbound(value: unknown, path: string): void {
	if (!isIdentityBearing(value) || foreignUnknownObjects.has(value)) return;
	throw new ForeignContractError(path, 'foreign-origin Unknown or native primitive', describeValue(value));
}

function describeValue(value: object): string {
	if (Array.isArray(value)) return 'Array';
	if (typeof value === 'function') return 'function';
	try { return Object.getPrototypeOf(value)?.constructor?.name ?? 'Object'; }
	catch { return 'object'; }
}

function recordFieldType(field: FfiTypeDescriptor | { readonly type: FfiTypeDescriptor }): FfiTypeDescriptor {
	return 'type' in field ? field.type : field;
}

function isTaggedValue(value: unknown): value is TaggedValue {
	return value !== null && typeof value === 'object' && typeof (value as { readonly $tag?: unknown }).$tag === 'string' && Array.isArray((value as { readonly $values?: unknown }).$values);
}

function isMapContainer(value: unknown): value is Iterable<readonly [unknown, unknown]> {
	return value !== null && typeof value === 'object' && Symbol.iterator in value && (value instanceof Map || (value as { readonly $viruneCollection?: unknown }).$viruneCollection === 'Map');
}

function isSetContainer(value: unknown): value is Iterable<unknown> {
	return value !== null && typeof value === 'object' && Symbol.iterator in value && (value instanceof Set || (value as { readonly $viruneCollection?: unknown }).$viruneCollection === 'Set');
}

function readOwnDataProperty(value: object, key: string, path: string): unknown | undefined {
	let property: PropertyDescriptor | undefined;
	try { property = Object.getOwnPropertyDescriptor(value, key); }
	catch (error) { throw new ForeignDecodeError(path, 'property descriptor access failed', error); }
	if (property === undefined) return undefined;
	if ('get' in property || 'set' in property) throw new ForeignDecodeError(path, 'accessor properties are not accepted by the Safe FFI provenance walker');
	return property.value;
}

function visitSafeUnknownLeaves(
	value: unknown,
	descriptor: FfiTypeDescriptor,
	direction: 'inbound' | 'outbound',
	path = '$',
	active = new WeakSet<object>(),
): void {
	if (descriptor.kind === 'unknown') {
		if (direction === 'inbound') safeUnknownInbound(value); else safeUnknownOutbound(value, path);
		return;
	}
	if (!isIdentityBearing(value)) return;
	if (active.has(value)) throw new ForeignDecodeError(path, 'cyclic value is not supported by the Safe FFI provenance walker');
	active.add(value);
	try {
		switch (descriptor.kind) {
			case 'list':
				if (Array.isArray(value)) value.forEach((item, index) => visitSafeUnknownLeaves(item, descriptor.item, direction, `${path}[${index}]`, active));
				return;
			case 'tuple':
				if (Array.isArray(value)) descriptor.items.forEach((item, index) => visitSafeUnknownLeaves(value[index], item, direction, `${path}[${index}]`, active));
				return;
			case 'map':
				if (isMapContainer(value)) {
					let index = 0;
					for (const [key, item] of value) {
						visitSafeUnknownLeaves(key, descriptor.key, direction, `${path}.key[${index}]`, active);
						visitSafeUnknownLeaves(item, descriptor.value, direction, `${path}.value[${index}]`, active);
						index++;
					}
				}
				return;
			case 'set':
				if (isSetContainer(value)) {
					let index = 0;
					for (const item of value) visitSafeUnknownLeaves(item, descriptor.item, direction, `${path}[${index++}]`, active);
				}
				return;
			case 'option':
				if (isTaggedValue(value) && value.$tag === 'Some' && value.$values.length === 1) visitSafeUnknownLeaves(value.$values[0], descriptor.value, direction, path, active);
				return;
			case 'result':
				if (isTaggedValue(value) && value.$values.length === 1) {
					if (value.$tag === 'Ok') visitSafeUnknownLeaves(value.$values[0], descriptor.value, direction, `${path}.Ok`, active);
					else if (value.$tag === 'Err') visitSafeUnknownLeaves(value.$values[0], descriptor.error, direction, `${path}.Err`, active);
				}
				return;
			case 'record':
				for (const [name, field] of Object.entries(descriptor.fields)) {
					const item = readOwnDataProperty(value, name, `${path}.${name}`);
					if (item !== undefined) visitSafeUnknownLeaves(item, recordFieldType(field), direction, `${path}.${name}`, active);
				}
				return;
			case 'enum':
				if (isTaggedValue(value)) {
					const fields = descriptor.variants[value.$tag];
					fields?.forEach((field, index) => visitSafeUnknownLeaves(value.$values[index], field, direction, `${path}.${value.$tag}[${index}]`, active));
				}
				return;
			default: return;
		}
	} finally {
		active.delete(value);
	}
}

/** Existing Runtime v2 signature with a compiler-private Safe envelope recognized at runtime. */
export function validateFfiValue(value: unknown, descriptor: FfiTypeDescriptor, path = '$', budget: DecodeBudget = defaultDecodeBudget): unknown {
	const envelope = safeEnvelope(descriptor);
	if (envelope === undefined) return legacyValidateFfiValue(value, descriptor, path, budget);
	const decoded = legacyValidateFfiValue(value, envelope.type, path, budget);
	visitSafeUnknownLeaves(decoded, envelope.type, 'inbound', path);
	return decoded;
}

/** Existing Runtime v2 signature with provenance enforcement for every compiler-private Safe Unknown leaf. */
export function encodeFfiValue(value: unknown, descriptor: FfiTypeDescriptor): unknown {
	const envelope = safeEnvelope(descriptor);
	if (envelope === undefined) return legacyEncodeFfiValue(value, descriptor);
	visitSafeUnknownLeaves(value, envelope.type, 'outbound');
	return legacyEncodeFfiValue(value, envelope.type);
}

function rejectionError(error: unknown): JsError {
	const converted = legacyToJsError(error);
	return { ...converted, name: 'PromiseRejectionError' };
}

/**
 * Existing Runtime v2 signature. Normal one-argument calls delegate to the
 * legacy implementation. Compiler-generated Safe wrappers may pass a private
 * decoder function as a second JavaScript argument.
 */
export async function safeCallAsync<T>(operation: () => PromiseLike<T>): Promise<Result<T, JsError>> {
	const decoder = (arguments as unknown as { readonly [index: number]: unknown })[1];
	if (typeof decoder !== 'function') return legacySafeCallAsync(operation);
	let pending: PromiseLike<T>;
	try { pending = operation(); } catch (error) { return Err(legacyToJsError(error)); }
	let value: T;
	try { value = await pending; } catch (error) { return Err(rejectionError(error)); }
	try { return Ok((decoder as (item: T) => T)(value)); } catch (error) { return Err(legacyToJsError(error)); }
}