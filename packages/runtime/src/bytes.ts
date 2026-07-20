import { Err, Ok, type Result } from './core.js';

export interface BytesError { readonly kind: 'BytesError'; readonly message: string; }
export type ByteOrder = 'BigEndian' | 'LittleEndian';

const encoder = new TextEncoder();

export function byteFromInt(value: number): Result<number, BytesError> {
	return Number.isSafeInteger(value) && value >= 0 && value <= 255 ? Ok(value) : Err({ kind: 'BytesError', message: `Byte value ${value} is outside 0..255` });
}

export const bytesEmpty = (): Uint8Array => new Uint8Array();
export const bytesLength = (value: Uint8Array): number => value.byteLength;
export const bytesFromUtf8 = (value: string): Uint8Array => encoder.encode(value);
export function bytesToUtf8(value: Uint8Array): Result<string, BytesError> {
	try { return Ok(new TextDecoder('utf-8', { fatal: true }).decode(value)); }
	catch (error) { return Err({ kind: 'BytesError', message: error instanceof Error ? error.message : String(error) }); }
}
export function bytesFromHex(value: string): Result<Uint8Array, BytesError> {
	if (!/^(?:[0-9a-fA-F]{2})*$/u.test(value)) return Err({ kind: 'BytesError', message: 'Hex input must contain an even number of hexadecimal digits' });
	return Ok(Uint8Array.from(value.match(/.{2}/gu) ?? [], item => Number.parseInt(item, 16)));
}
export const bytesToHex = (value: Uint8Array): string => [...value].map(item => item.toString(16).padStart(2, '0')).join('');
export function bytesFromBase64(value: string): Result<Uint8Array, BytesError> {
	try {
		if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) return Err({ kind: 'BytesError', message: 'Invalid base64 input' });
		return Ok(Uint8Array.from(Buffer.from(value, 'base64')));
	} catch (error) { return Err({ kind: 'BytesError', message: error instanceof Error ? error.message : String(error) }); }
}
export const bytesToBase64 = (value: Uint8Array): string => Buffer.from(value).toString('base64');
export const bytesConcat = (left: Uint8Array, right: Uint8Array): Uint8Array => {
	const result = new Uint8Array(left.byteLength + right.byteLength);
	result.set(left, 0); result.set(right, left.byteLength); return result;
};
export const bytesSlice = (value: Uint8Array, start: number, end: number): Uint8Array => value.slice(start, end);
export function bytesGet(value: Uint8Array, index: number): Result<number, BytesError> {
	return Number.isSafeInteger(index) && index >= 0 && index < value.length ? Ok(value[index] as number) : Err({ kind: 'BytesError', message: `Index ${index} is outside Bytes length ${value.length}` });
}
export function bytesSet(value: Uint8Array, index: number, byte: number): Result<Uint8Array, BytesError> {
	if (!Number.isSafeInteger(index) || index < 0 || index >= value.length) return Err({ kind: 'BytesError', message: `Index ${index} is outside Bytes length ${value.length}` });
	const checked = byteFromInt(byte); if (checked.$tag === 'Err') return checked;
	const result = value.slice(); result[index] = byte; return Ok(result);
}
function view(value: Uint8Array): DataView { return new DataView(value.buffer, value.byteOffset, value.byteLength); }
function little(order: ByteOrder): boolean { return order === 'LittleEndian'; }
export function bytesReadInt32(value: Uint8Array, offset: number, order: ByteOrder): Result<number, BytesError> {
	if (!Number.isSafeInteger(offset) || offset < 0 || offset + 4 > value.length) return Err({ kind: 'BytesError', message: `Cannot read Int32 at offset ${offset}` });
	return Ok(view(value).getInt32(offset, little(order)));
}
export function bytesWriteInt32(value: Uint8Array, offset: number, item: number, order: ByteOrder): Result<Uint8Array, BytesError> {
	if (!Number.isSafeInteger(offset) || offset < 0 || offset + 4 > value.length || !Number.isInteger(item) || item < -2147483648 || item > 2147483647) return Err({ kind: 'BytesError', message: 'Invalid Int32 write' });
	const result = value.slice(); view(result).setInt32(offset, item, little(order)); return Ok(result);
}

/** Creates a checked Byte value. */
export const byteCreate = byteFromInt;


export function mutableBytesCreate(length: number): Result<Uint8Array, BytesError> {
	if (!Number.isSafeInteger(length) || length < 0) return Err({ kind: 'BytesError', message: `MutableBytes length ${length} must be a non-negative safe integer` });
	return Ok(new Uint8Array(length));
}
export const mutableBytesFromBytes = (value: Uint8Array): Uint8Array => value.slice();
export const mutableBytesToBytes = (value: Uint8Array): Uint8Array => value.slice();
export const mutableBytesLength = (value: Uint8Array): number => value.byteLength;
export function mutableBytesGet(value: Uint8Array, index: number): Result<number, BytesError> {
	return bytesGet(value, index);
}
export function mutableBytesSet(value: Uint8Array, index: number, byte: number): Result<undefined, BytesError> {
	if (!Number.isSafeInteger(index) || index < 0 || index >= value.length) return Err({ kind: 'BytesError', message: `Index ${index} is outside MutableBytes length ${value.length}` });
	const checked = byteFromInt(byte);
	if (checked.$tag === 'Err') return checked;
	value[index] = checked.$values[0];
	return Ok(undefined);
}
export function mutableBytesFill(value: Uint8Array, byte: number): Result<undefined, BytesError> {
	const checked = byteFromInt(byte);
	if (checked.$tag === 'Err') return checked;
	value.fill(checked.$values[0]);
	return Ok(undefined);
}
