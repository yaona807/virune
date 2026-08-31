import { Err, Ok, VirunePanic, VirunePropagation, type Result } from './core.js';
import {
	ForeignContractError,
	ForeignDecodeError,
	defaultDecodeBudget,
	encodeFfiValue as legacyEncodeFfiValue,
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

const foreignUnknownObjects = new WeakSet<object>();

function safeEnvelope(descriptor: FfiTypeDescriptor): SafeFfiEnvelope | undefined {
	const candidate = descriptor as unknown;
	if (candidate === null || typeof candidate !== 'object') throw new ForeignDecodeError('$descriptor', 'FFI descriptor must be an object');
	const record = candidate as Record<string, unknown>;
	if (Object.hasOwn(record, 'kind')) return undefined;
	const keys = Object.keys(record).sort();
	if (
		record.version !== 'virune-safe-ffi/v1'
		|| keys.length !== 2
		|| keys[0] !== 'type'
		|| keys[1] !== 'version'
		|| record.type === null
		|| typeof record.type !== 'object'
		|| typeof (record.type as { readonly kind?: unknown }).kind !== 'string'
	) throw new ForeignDecodeError('$descriptor', 'unsupported, stale, partial, or malformed Safe FFI envelope');
	return record as unknown as SafeFfiEnvelope;
}

function isIdentityBearing(value: unknown): value is object {
	return value !== null && (typeof value === 'object' || typeof value === 'function');
}

function safeUnknownInbound(value: unknown): unknown {
	if (isIdentityBearing(value)) foreignUnknownObjects.add(value);
	return value;
}

function safeUnknownOutbound(value: unknown): unknown {
	if (!isIdentityBearing(value)) return value;
	if (foreignUnknownObjects.has(value)) return value;
	throw new ForeignContractError('$', 'foreign-origin Unknown or native primitive', describeValue(value));
}

function describeValue(value: unknown): string {
	if (value === null) return 'null';
	if (Array.isArray(value)) return 'Array';
	if (typeof value === 'object') return Object.getPrototypeOf(value)?.constructor?.name ?? 'Object';
	return typeof value;
}

/** Existing Runtime v2 signature with a compiler-private Safe envelope recognized at runtime. */
export function validateFfiValue(value: unknown, descriptor: FfiTypeDescriptor, path = '$', budget: DecodeBudget = defaultDecodeBudget): unknown {
	const envelope = safeEnvelope(descriptor);
	if (envelope === undefined) return legacyValidateFfiValue(value, descriptor, path, budget);
	if (envelope.type.kind === 'unknown') return safeUnknownInbound(value);
	return legacyValidateFfiValue(value, envelope.type, path, budget);
}

/** Existing Runtime v2 signature with provenance enforcement only for compiler-private Safe Unknown. */
export function encodeFfiValue(value: unknown, descriptor: FfiTypeDescriptor): unknown {
	const envelope = safeEnvelope(descriptor);
	if (envelope === undefined) return legacyEncodeFfiValue(value, descriptor);
	if (envelope.type.kind === 'unknown') return safeUnknownOutbound(value);
	return legacyEncodeFfiValue(value, envelope.type);
}

/** Existing Runtime v2 signature; Virune-only control identity is sanitized before FFI exposure. */
export function toJsError(error: unknown): JsError {
	if (error instanceof VirunePanic || error instanceof VirunePropagation) {
		return { kind: 'JsError', name: 'ViruneInternalError', message: 'Virune internal failure' };
	}
	return legacyToJsError(error);
}

/** Existing Runtime v2 signature. */
export function safeCall<T>(operation: () => T): Result<T, JsError> {
	try { return Ok(operation()); } catch (error) { return Err(toJsError(error)); }
}

function rejectionError(error: unknown): JsError {
	const converted = toJsError(error);
	if (converted.name === 'ViruneInternalError') return converted;
	return { kind: 'JsError', name: 'PromiseRejectionError', message: converted.message };
}

/**
 * Existing Runtime v2 signature. Compiler-generated wrappers may pass a private
 * decoder as a second JavaScript argument; it is intentionally absent from the
 * public TypeScript contract.
 */
export async function safeCallAsync<T>(operation: () => PromiseLike<T>): Promise<Result<T, JsError>> {
	let pending: PromiseLike<T>;
	try { pending = operation(); } catch (error) { return Err(toJsError(error)); }
	let value: T;
	try { value = await pending; } catch (error) { return Err(rejectionError(error)); }
	const decoder = (arguments as unknown as { readonly [index: number]: unknown })[1];
	if (decoder === undefined) return Ok(value);
	if (typeof decoder !== 'function') return Err(toJsError(new ForeignDecodeError('$decoder', 'generated Safe decoder is not callable')));
	try { return Ok((decoder as (item: T) => T)(value)); } catch (error) { return Err(toJsError(error)); }
}
