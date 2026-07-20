import { Err, Ok, type Result } from './core.js';

export interface IntegerRangeError { readonly kind: 'IntegerRangeError'; readonly type: string; readonly value: string; }

const intRanges: Readonly<Record<string, readonly [number, number]>> = {
	Byte: [0, 255], Int8: [-128, 127], UInt8: [0, 255], Int16: [-32768, 32767], UInt16: [0, 65535], Int32: [-2147483648, 2147483647], UInt32: [0, 4294967295],
};
const bigintRanges: Readonly<Record<string, readonly [bigint, bigint]>> = {
	Int64: [-(1n << 63n), (1n << 63n) - 1n], UInt64: [0n, (1n << 64n) - 1n],
};

export function fixedIntFromInt(type: string, value: number): Result<number, IntegerRangeError> {
	const range = intRanges[type];
	return range !== undefined && Number.isSafeInteger(value) && value >= range[0] && value <= range[1]
		? Ok(value)
		: Err({ kind: 'IntegerRangeError', type, value: String(value) });
}
export function fixedIntFromBigInt(type: string, value: bigint): Result<bigint, IntegerRangeError> {
	const range = bigintRanges[type];
	return range !== undefined && value >= range[0] && value <= range[1]
		? Ok(value)
		: Err({ kind: 'IntegerRangeError', type, value: String(value) });
}
export const fixedIntToInt = (value: number): number => value;
export const fixedIntToBigInt = (value: bigint): bigint => value;

export const int8Create = (value: number): Result<number, IntegerRangeError> => fixedIntFromInt('Int8', value);
export const uint8Create = (value: number): Result<number, IntegerRangeError> => fixedIntFromInt('UInt8', value);
export const int16Create = (value: number): Result<number, IntegerRangeError> => fixedIntFromInt('Int16', value);
export const uint16Create = (value: number): Result<number, IntegerRangeError> => fixedIntFromInt('UInt16', value);
export const int32Create = (value: number): Result<number, IntegerRangeError> => fixedIntFromInt('Int32', value);
export const uint32Create = (value: number): Result<number, IntegerRangeError> => fixedIntFromInt('UInt32', value);
export const int64Create = (value: bigint): Result<bigint, IntegerRangeError> => fixedIntFromBigInt('Int64', value);
export const uint64Create = (value: bigint): Result<bigint, IntegerRangeError> => fixedIntFromBigInt('UInt64', value);
export const int8ToInt = fixedIntToInt;
export const uint8ToInt = fixedIntToInt;
export const int16ToInt = fixedIntToInt;
export const uint16ToInt = fixedIntToInt;
export const int32ToInt = fixedIntToInt;
export const uint32ToInt = fixedIntToInt;
export const int64ToBigInt = fixedIntToBigInt;
export const uint64ToBigInt = fixedIntToBigInt;
