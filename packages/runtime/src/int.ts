import { Err, Ok, panic, type Result } from './core.js';

export interface NumericConversionError {
	readonly kind: 'NumericConversionError';
	readonly message: string;
}

function checked(value: number, operation: string): number {
	if (!Number.isSafeInteger(value)) panic(`Int ${operation} produced a value outside the safe integer range`);
	return value;
}

export function intAdd(left: number, right: number): number { return checked(left + right, 'addition'); }
export function intSubtract(left: number, right: number): number { return checked(left - right, 'subtraction'); }
export function intMultiply(left: number, right: number): number { return checked(left * right, 'multiplication'); }
export function intDivide(left: number, right: number): number {
	if (right === 0) panic('Int division by zero');
	return checked(Math.trunc(left / right), 'division');
}
export function intRemainder(left: number, right: number): number {
	if (right === 0) panic('Int remainder by zero');
	return checked(left % right, 'remainder');
}
export function intNegate(value: number): number { return checked(-value, 'negation'); }
export function intToFloat(value: number): number { return value; }
export function floatToInt(value: number): Result<number, NumericConversionError> {
	if (!Number.isFinite(value) || !Number.isSafeInteger(Math.trunc(value))) {
		return Err({ kind: 'NumericConversionError', message: `Cannot convert ${String(value)} to Int` });
	}
	return Ok(Math.trunc(value));
}
export function assertInt(value: unknown): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value)) panic(`Expected Int, received ${String(value)}`);
	return value;
}
