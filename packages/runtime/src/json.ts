import { Err, Ok, makeRecord, makeVariant, type Result } from './core.js';
import { ViruneMap, ViruneSet } from './collections.js';
import { bytesFromBase64, bytesToBase64 } from './bytes.js';

export interface JsonError {
	readonly path: string;
	readonly expected: string;
	readonly actual: string;
	readonly message: string;
}

export type Decoder<T> = (value: unknown, path?: string) => Result<T, readonly JsonError[]>;

const actualType = (value: unknown): string => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
const failure = (path: string, expected: string, value: unknown): Result<never, readonly JsonError[]> => Err([{ path, expected, actual: actualType(value), message: `Expected ${expected} at ${path}, received ${actualType(value)}` }]);

export const decodeUnknown: Decoder<unknown> = value => Ok(value);
export const decodeString: Decoder<string> = (value, path = '$') => typeof value === 'string' ? Ok(value) : failure(path, 'String', value);
export const decodeBool: Decoder<boolean> = (value, path = '$') => typeof value === 'boolean' ? Ok(value) : failure(path, 'Bool', value);
export const decodeInt: Decoder<number> = (value, path = '$') => typeof value === 'number' && Number.isSafeInteger(value) ? Ok(value) : failure(path, 'Int', value);
export const decodeFloat: Decoder<number> = (value, path = '$') => typeof value === 'number' ? Ok(value) : failure(path, 'Float', value);

export function decodeList<T>(item: Decoder<T>): Decoder<readonly T[]> {
	return (value, path = '$') => {
		if (!Array.isArray(value)) return failure(path, 'List', value);
		const output: T[] = [];
		const errors: JsonError[] = [];
		value.forEach((element, index) => {
			const result = item(element, `${path}[${index}]`);
			if (result.$tag === 'Ok') output.push(result.$values[0]); else errors.push(...result.$values[0]);
		});
		return errors.length > 0 ? Err(errors) : Ok(output);
	};
}

export function decodeOption<T>(item: Decoder<T>): Decoder<import('./core.js').Option<T>> {
	return (value, path = '$') => {
		if (value === null || value === undefined) return Ok(importNone());
		const result = item(value, path);
		return result.$tag === 'Ok' ? Ok(importSome(result.$values[0])) : result;
	};
}

function importNone(): import('./core.js').Option<never> { return { $tag: 'None', $values: [] }; }
function importSome<T>(value: T): import('./core.js').Option<T> { return { $tag: 'Some', $values: [value] }; }

export function decodeRecord<T extends Record<string, unknown>>(
	fields: Readonly<Record<keyof T & string, Decoder<unknown>>>,
	options: { readonly strict?: boolean } = {},
): Decoder<T> {
	return (value, path = '$') => {
		if (value === null || typeof value !== 'object' || Array.isArray(value)) return failure(path, 'record', value);
		const source = value as Record<string, unknown>;
		const output: Record<string, unknown> = {};
		const errors: JsonError[] = [];
		for (const [name, decoder] of Object.entries(fields)) {
			const result = decoder(source[name], `${path}.${name}`);
			if (result.$tag === 'Ok') output[name] = result.$values[0]; else errors.push(...result.$values[0]);
		}
		if (options.strict) {
			for (const name of Object.keys(source)) {
				if (!Object.hasOwn(fields, name)) errors.push({ path: `${path}.${name}`, expected: 'no additional field', actual: actualType(source[name]), message: `Unexpected field ${name} at ${path}` });
			}
		}
		return errors.length > 0 ? Err(errors) : Ok(makeRecord(output) as T);
	};
}

export function parseJson(text: string): Result<unknown, readonly JsonError[]> {
	try { return Ok(JSON.parse(text)); }
	catch (error) { return Err([{ path: '$', expected: 'valid JSON', actual: 'invalid JSON', message: error instanceof Error ? error.message : String(error) }]); }
}

import type { FfiRecordFieldDescriptor, FfiTypeDescriptor } from './ffi.js';

function normalizeRecordField(name: string, field: FfiTypeDescriptor | FfiRecordFieldDescriptor): { readonly type: FfiTypeDescriptor; readonly jsonName: string; readonly hasDefault: boolean; readonly defaultValue?: unknown } {
	if ('type' in field) return { type: field.type, jsonName: field.jsonName ?? name, hasDefault: field.hasDefault === true, ...(field.hasDefault === true ? { defaultValue: field.defaultValue } : {}) };
	return { type: field, jsonName: name, hasDefault: false };
}


function isMapIterable(value: unknown): value is Iterable<readonly [unknown, unknown]> {
	return value !== null && typeof value === 'object' && Symbol.iterator in value && (value instanceof Map || (value as { readonly $viruneCollection?: unknown }).$viruneCollection === 'Map');
}

function isSetIterable(value: unknown): value is Iterable<unknown> {
	return value !== null && typeof value === 'object' && Symbol.iterator in value && (value instanceof Set || (value as { readonly $viruneCollection?: unknown }).$viruneCollection === 'Set');
}

function decodeDescriptor(value: unknown, descriptor: FfiTypeDescriptor, path: string): Result<unknown, readonly JsonError[]> {
	switch (descriptor.kind) {
		case 'unknown': return Ok(value);
		case 'string': return decodeString(value, path);
		case 'bool': return decodeBool(value, path);
		case 'int': return decodeInt(value, path);
		case 'float': return decodeFloat(value, path);
		case 'bigint': return failure(path, 'JSON-compatible value (BigInt is unsupported)', value);
		case 'unit': return value === null ? Ok(undefined) : failure(path, 'null', value);
		case 'undefined': return failure(path, 'JSON value (undefined is unsupported)', value);
		case 'null': return value === null ? Ok(null) : failure(path, 'null', value);
		case 'bytes': {
			if (typeof value !== 'string') return failure(path, 'base64 String', value);
			const decoded = bytesFromBase64(value);
			return decoded.$tag === 'Ok' ? Ok(decoded.$values[0]) : Err([{ path, expected: 'valid base64 String', actual: 'string', message: decoded.$values[0].message }]);
		}
		case 'option': {
			if (value === null) return Ok(importNone());
			const decoded = decodeDescriptor(value, descriptor.value, path);
			return decoded.$tag === 'Ok' ? Ok(importSome(decoded.$values[0])) : decoded;
		}
		case 'tuple': {
			if (!Array.isArray(value) || value.length !== descriptor.items.length) return failure(path, `tuple of length ${descriptor.items.length}`, value);
			const output: unknown[] = []; const errors: JsonError[] = [];
			descriptor.items.forEach((item, index) => { const decoded = decodeDescriptor(value[index], item, `${path}[${index}]`); if (decoded.$tag === 'Ok') output.push(decoded.$values[0]); else errors.push(...decoded.$values[0]); });
			return errors.length > 0 ? Err(errors) : Ok(output);
		}
		case 'list': {			if (!Array.isArray(value)) return failure(path, 'List', value);
			const output: unknown[] = []; const errors: JsonError[] = [];
			value.forEach((item, index) => { const decoded = decodeDescriptor(item, descriptor.item, `${path}[${index}]`); if (decoded.$tag === 'Ok') output.push(decoded.$values[0]); else errors.push(...decoded.$values[0]); });
			return errors.length > 0 ? Err(errors) : Ok(output);
		}
		case 'set': {
			const decoded = decodeDescriptor(value, { kind: 'list', item: descriptor.item }, path);
			return decoded.$tag === 'Ok' ? Ok(new ViruneSet(decoded.$values[0] as readonly unknown[])) : decoded;
		}
		case 'map': {
			if (descriptor.key.kind !== 'string') return Err([{ path, expected: 'Map with String keys', actual: 'unsupported key type', message: `Only Map<String, T> can be decoded from JSON at ${path}` }]);
			if (value === null || typeof value !== 'object' || Array.isArray(value)) return failure(path, 'object', value);
			const entries: Array<readonly [string, unknown]> = []; const errors: JsonError[] = [];
			for (const [key, item] of Object.entries(value)) { const decoded = decodeDescriptor(item, descriptor.value, `${path}.${key}`); if (decoded.$tag === 'Ok') entries.push([key, decoded.$values[0]]); else errors.push(...decoded.$values[0]); }
			return errors.length > 0 ? Err(errors) : Ok(new ViruneMap(entries));
		}
		case 'record': {
			if (value === null || typeof value !== 'object' || Array.isArray(value)) return failure(path, descriptor.name, value);
			const source = value as Record<string, unknown>; const output: Record<string, unknown> = {}; const errors: JsonError[] = [];
			const acceptedNames = new Set<string>();
			for (const [name, rawField] of Object.entries(descriptor.fields)) {
				const field = normalizeRecordField(name, rawField); acceptedNames.add(field.jsonName);
				if (!Object.hasOwn(source, field.jsonName) && field.hasDefault) { output[name] = field.defaultValue; continue; }
				const decoded = decodeDescriptor(source[field.jsonName], field.type, `${path}.${field.jsonName}`);
				if (decoded.$tag === 'Ok') output[name] = decoded.$values[0]; else errors.push(...decoded.$values[0]);
			}
			if (descriptor.strict === true) for (const name of Object.keys(source)) if (!acceptedNames.has(name)) errors.push({ path: `${path}.${name}`, expected: 'no additional field', actual: actualType(source[name]), message: `Unexpected field ${name} at ${path}` });
			return errors.length > 0 ? Err(errors) : Ok(makeRecord(output, descriptor.typeId ?? descriptor.name));
		}
		case 'result': return decodeTagged(value, path, { Ok: [descriptor.value], Err: [descriptor.error] });
		case 'enum': return decodeTagged(value, path, descriptor.variants, descriptor.typeId ?? descriptor.name);
	}
}

function decodeTagged(value: unknown, path: string, variants: Readonly<Record<string, readonly FfiTypeDescriptor[]>>, typeId?: string): Result<unknown, readonly JsonError[]> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return failure(path, 'tagged enum object', value);
	const source = value as Record<string, unknown>; const tag = source.tag; const values = source.values;
	if (typeof tag !== 'string' || !Array.isArray(values)) return failure(path, '{ tag: String, values: List }', value);
	const descriptors = variants[tag];
	if (descriptors === undefined || descriptors.length !== values.length) return Err([{ path, expected: `one of ${Object.keys(variants).join(', ')}`, actual: tag, message: `Unknown or invalid enum variant ${tag} at ${path}` }]);
	const output: unknown[] = []; const errors: JsonError[] = [];
	descriptors.forEach((descriptor, index) => { const decoded = decodeDescriptor(values[index], descriptor, `${path}.values[${index}]`); if (decoded.$tag === 'Ok') output.push(decoded.$values[0]); else errors.push(...decoded.$values[0]); });
	return errors.length > 0 ? Err(errors) : Ok(makeVariant(tag, output, typeId));
}

export function decodeJsonValue(value: unknown, descriptor: FfiTypeDescriptor): Result<unknown, readonly JsonError[]> {
	return decodeDescriptor(value, descriptor, '$');
}

function encodeDescriptor(value: unknown, descriptor: FfiTypeDescriptor, path: string): Result<unknown, readonly JsonError[]> {
	switch (descriptor.kind) {
		case 'unknown': return Ok(value);
		case 'string': case 'bool': case 'int': case 'float': return Ok(value);
		case 'bigint': return Err([{ path, expected: 'JSON-compatible value', actual: 'bigint', message: `BigInt cannot be encoded as JSON at ${path}` }]);
		case 'unit': return Ok(null);
		case 'undefined': return Err([{ path, expected: 'JSON-compatible value', actual: 'undefined', message: `undefined cannot be encoded as JSON at ${path}` }]);
		case 'null': return value === null ? Ok(null) : failure(path, 'null', value);
		case 'bytes': return value instanceof Uint8Array ? Ok(bytesToBase64(value)) : failure(path, 'Bytes', value);
		case 'option': {
			if (value !== null && typeof value === 'object' && (value as { $tag?: unknown }).$tag === 'None') return Ok(null);
			if (value !== null && typeof value === 'object' && (value as { $tag?: unknown }).$tag === 'Some') return encodeDescriptor((value as { $values: readonly unknown[] }).$values[0], descriptor.value, path);
			return Err([{ path, expected: 'Option', actual: actualType(value), message: `Invalid Option value at ${path}` }]);
		}
		case 'tuple': {
			if (!Array.isArray(value) || value.length !== descriptor.items.length) return failure(path, `tuple of length ${descriptor.items.length}`, value);
			const output: unknown[] = []; const errors: JsonError[] = [];
			descriptor.items.forEach((item, index) => { const encoded = encodeDescriptor(value[index], item, `${path}[${index}]`); if (encoded.$tag === 'Ok') output.push(encoded.$values[0]); else errors.push(...encoded.$values[0]); });
			return errors.length > 0 ? Err(errors) : Ok(output);
		}
		case 'list': {
			if (!Array.isArray(value)) return failure(path, 'List', value);
			return encodeSequence(value, descriptor.item, path);
		}
		case 'set': {
			if (!isSetIterable(value)) return failure(path, 'Set', value);
			return encodeSequence([...value], descriptor.item, path);
		}
		case 'map': {
			if (!isMapIterable(value) || descriptor.key.kind !== 'string') return Err([{ path, expected: 'Map<String, T>', actual: actualType(value), message: `Only Map<String, T> can be encoded as JSON at ${path}` }]);
			const output: Record<string, unknown> = {}; const errors: JsonError[] = [];
			for (const [key, item] of value) { if (typeof key !== 'string') { errors.push({ path, expected: 'String key', actual: typeof key, message: `Map key must be String at ${path}` }); continue; } const encoded = encodeDescriptor(item, descriptor.value, `${path}.${key}`); if (encoded.$tag === 'Ok') output[key] = encoded.$values[0]; else errors.push(...encoded.$values[0]); }
			return errors.length > 0 ? Err(errors) : Ok(output);
		}
		case 'record': {
			if (value === null || typeof value !== 'object') return failure(path, descriptor.name, value);
			const output: Record<string, unknown> = {}; const errors: JsonError[] = [];
			for (const [name, rawField] of Object.entries(descriptor.fields)) {
				const field = normalizeRecordField(name, rawField);
				const encoded = encodeDescriptor((value as Record<string, unknown>)[name], field.type, `${path}.${field.jsonName}`);
				if (encoded.$tag === 'Ok') output[field.jsonName] = encoded.$values[0]; else errors.push(...encoded.$values[0]);
			}
			return errors.length > 0 ? Err(errors) : Ok(output);
		}
		case 'result': return encodeTagged(value, path, { Ok: [descriptor.value], Err: [descriptor.error] });
		case 'enum': return encodeTagged(value, path, descriptor.variants);
	}
}

function encodeSequence(values: readonly unknown[], descriptor: FfiTypeDescriptor, path: string): Result<unknown, readonly JsonError[]> {
	const output: unknown[] = []; const errors: JsonError[] = [];
	values.forEach((item, index) => { const encoded = encodeDescriptor(item, descriptor, `${path}[${index}]`); if (encoded.$tag === 'Ok') output.push(encoded.$values[0]); else errors.push(...encoded.$values[0]); });
	return errors.length > 0 ? Err(errors) : Ok(output);
}

function encodeTagged(value: unknown, path: string, variants: Readonly<Record<string, readonly FfiTypeDescriptor[]>>): Result<unknown, readonly JsonError[]> {
	if (value === null || typeof value !== 'object' || typeof (value as { $tag?: unknown }).$tag !== 'string' || !Array.isArray((value as { $values?: unknown }).$values)) return failure(path, 'enum', value);
	const tagged = value as { $tag: string; $values: readonly unknown[] }; const descriptors = variants[tagged.$tag];
	if (descriptors === undefined || descriptors.length !== tagged.$values.length) return Err([{ path, expected: `one of ${Object.keys(variants).join(', ')}`, actual: tagged.$tag, message: `Unknown or invalid enum variant ${tagged.$tag} at ${path}` }]);
	const values: unknown[] = []; const errors: JsonError[] = [];
	descriptors.forEach((descriptor, index) => { const encoded = encodeDescriptor(tagged.$values[index], descriptor, `${path}.values[${index}]`); if (encoded.$tag === 'Ok') values.push(encoded.$values[0]); else errors.push(...encoded.$values[0]); });
	return errors.length > 0 ? Err(errors) : Ok({ tag: tagged.$tag, values });
}

export function encodeJsonValue(value: unknown, descriptor: FfiTypeDescriptor): Result<string, readonly JsonError[]> {
	const encoded = encodeDescriptor(value, descriptor, '$');
	if (encoded.$tag === 'Err') return encoded;
	try { return Ok(JSON.stringify(encoded.$values[0])); }
	catch (error) { return Err([{ path: '$', expected: 'JSON-serializable value', actual: actualType(value), message: error instanceof Error ? error.message : String(error) }]); }
}
