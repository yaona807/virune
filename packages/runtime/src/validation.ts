import { Err, Ok, type Result } from './core.js';

export type Validation<T, E> = Result<T, readonly E[]>;

export const valid = <T>(value: T): Validation<T, never> => Ok(value);
export const invalid = <E>(error: E): Validation<never, E> => Err([error]);

export function validationMap<T, E, U>(value: Validation<T, E>, mapper: (item: T) => U): Validation<U, E> {
	return value.$tag === 'Ok' ? Ok(mapper(value.$values[0])) : value;
}

export function validationAndThen<T, E, U>(value: Validation<T, E>, mapper: (item: T) => Validation<U, E>): Validation<U, E> {
	return value.$tag === 'Ok' ? mapper(value.$values[0]) : value;
}

export function validationCombine<T extends Record<string, Validation<unknown, E>>, E>(
	fields: T,
): Validation<{ readonly [K in keyof T]: T[K] extends Validation<infer V, E> ? V : never }, E> {
	const output: Record<string, unknown> = Object.create(null);
	const errors: E[] = [];
	for (const [name, result] of Object.entries(fields)) {
		if (result.$tag === 'Ok') output[name] = result.$values[0];
		else errors.push(...result.$values[0] as readonly E[]);
	}
	return errors.length > 0 ? Err(errors) : Ok(output as { readonly [K in keyof T]: T[K] extends Validation<infer V, E> ? V : never });
}

export function validationCollect<T, E>(values: readonly Validation<T, E>[]): Validation<readonly T[], E> {
	const output: T[] = [];
	const errors: E[] = [];
	for (const result of values) {
		if (result.$tag === 'Ok') output.push(result.$values[0]);
		else errors.push(...result.$values[0]);
	}
	return errors.length > 0 ? Err(errors) : Ok(output);
}
