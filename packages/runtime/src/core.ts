export type Unit = undefined;

export interface ViruneVariant<Tag extends string = string, Values extends readonly unknown[] = readonly unknown[]> {
	readonly $tag: Tag;
	readonly $values: Values;
}

export type Option<T> = ViruneVariant<'Some', readonly [T]> | ViruneVariant<'None', readonly []>;
export type Result<T, E> = ViruneVariant<'Ok', readonly [T]> | ViruneVariant<'Err', readonly [E]>;

export const Unit: Unit = undefined;
export const None: Option<never> = Object.freeze({ $tag: 'None', $values: Object.freeze([]) as readonly [] });

export function Some<T>(value: T): Option<T> {
	return { $tag: 'Some', $values: [value] };
}

export function Ok<T>(value: T): Result<T, never> {
	return { $tag: 'Ok', $values: [value] };
}

export function Err<E>(error: E): Result<never, E> {
	return { $tag: 'Err', $values: [error] };
}

export function isSome<T>(value: Option<T>): value is ViruneVariant<'Some', readonly [T]> {
	return value.$tag === 'Some';
}

export function isNone<T>(value: Option<T>): value is ViruneVariant<'None', readonly []> {
	return value.$tag === 'None';
}

export function isOk<T, E>(value: Result<T, E>): value is ViruneVariant<'Ok', readonly [T]> {
	return value.$tag === 'Ok';
}

export function isErr<T, E>(value: Result<T, E>): value is ViruneVariant<'Err', readonly [E]> {
	return value.$tag === 'Err';
}


export class VirunePropagation extends Error {
	public constructor(readonly value: Option<unknown> | Result<unknown, unknown>) {
		super('Virune control-flow propagation');
		this.name = 'VirunePropagation';
	}
}

export function propagate<T>(value: Option<T> | Result<T, unknown>): T {
	if (value.$tag === 'Some' || value.$tag === 'Ok') return value.$values[0];
	throw new VirunePropagation(value);
}

export function isPropagation(value: unknown): value is VirunePropagation {
	return value instanceof VirunePropagation;
}

export class VirunePanic extends Error {
	public readonly code = 'VIRUNE_PANIC';
	public constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'VirunePanic';
	}
}

export function panic(message: string): never {
	throw new VirunePanic(message);
}

export function expectOption<T>(value: Option<T>, message: string): T {
	if (value.$tag === 'Some') return value.$values[0];
	return panic(message);
}

export function expectResult<T, E>(value: Result<T, E>, message: string): T {
	if (value.$tag === 'Ok') return value.$values[0];
	return panic(`${message}: ${debugValue(value.$values[0])}`);
}

export function debugValue(value: unknown): string {
	if (typeof value === 'string') return JSON.stringify(value);
	if (typeof value === 'bigint') return `${value}n`;
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}


export function resultMapError<T, E, F>(value: Result<T, E>, mapper: (error: E) => F): Result<T, F> {
	return value.$tag === 'Ok' ? value : Err(mapper(value.$values[0]));
}

export function optionMap<T, U>(value: Option<T>, mapper: (item: T) => U): Option<U> {
	return value.$tag === 'Some' ? Some(mapper(value.$values[0])) : None;
}

export function makeVariant<Tag extends string, Values extends readonly unknown[]>(tag: Tag, values: Values, typeId?: string): ViruneVariant<Tag, Values> {
	const value = { $tag: tag, $values: values };
	if (typeId !== undefined) Object.defineProperty(value, '$type', { value: typeId, enumerable: false });
	return value;
}

export function makeRecord<T extends Record<string, unknown>>(fields: T, typeId?: string): Readonly<T> {
	const value = Object.assign(Object.create(null) as T, fields);
	if (typeId !== undefined) Object.defineProperty(value, '$type', { value: typeId, enumerable: false });
	return value;
}

export function updateRecord<T extends Record<string, unknown>>(base: T, updates: Partial<T>): Readonly<T> {
	return makeRecord({ ...base, ...updates });
}

interface ViruneMapLike {
	readonly $viruneCollection: 'Map';
	readonly size: number;
	entries(): IterableIterator<readonly [unknown, unknown]>;
	has(key: unknown): boolean;
	get(key: unknown): unknown;
}
interface ViruneSetLike {
	readonly $viruneCollection: 'Set';
	readonly size: number;
	values(): IterableIterator<unknown>;
	has(value: unknown): boolean;
}
const isViruneMap = (value: unknown): value is ViruneMapLike => value !== null && typeof value === 'object' && (value as { readonly $viruneCollection?: unknown }).$viruneCollection === 'Map';
const isViruneSet = (value: unknown): value is ViruneSetLike => value !== null && typeof value === 'object' && (value as { readonly $viruneCollection?: unknown }).$viruneCollection === 'Set';

function nominalTypeId(value: unknown): string | undefined {
	return value !== null && typeof value === 'object' && '$type' in value && typeof (value as { readonly $type?: unknown }).$type === 'string'
		? (value as { readonly $type: string }).$type
		: undefined;
}

export function viruneHash(value: unknown, seen = new WeakMap<object, number>()): number {
	const mix = (hash: number, item: number): number => Math.imul(hash ^ item, 16777619) >>> 0;
	const textHash = (text: string): number => { let hash = 2166136261; for (const character of text) hash = mix(hash, character.codePointAt(0) ?? 0); return hash; };
	if (value === undefined) return 0x811c9dc5;
	if (typeof value === 'boolean') return value ? 0x345678 : 0x123456;
	if (typeof value === 'string') return mix(0x1001, textHash(value));
	if (typeof value === 'bigint') return mix(0x1002, textHash(String(value)));
	if (typeof value === 'number') return mix(Number.isSafeInteger(value) ? 0x1003 : 0x1004, textHash(Object.is(value, -0) ? '0' : String(value)));
	if (value === null) return 0x1005;
	const known = seen.get(value);
	if (known !== undefined) return known;
	let hash = mix(0x1006, textHash(Object.prototype.toString.call(value)));
	const typeId = nominalTypeId(value);
	if (typeId !== undefined) hash = mix(hash, textHash(typeId));
	seen.set(value, hash);
	if (value instanceof Uint8Array) { for (const byte of value) hash = mix(hash, byte); return hash; }
	if (Array.isArray(value)) { for (const item of value) hash = mix(hash, viruneHash(item, seen)); return hash; }
	if (isViruneMap(value)) {
		const pairs = [...value.entries()].map(([key, item]) => mix(viruneHash(key, seen), viruneHash(item, seen))).sort((a, b) => a - b);
		for (const pair of pairs) hash = mix(hash, pair); return hash;
	}
	if (isViruneSet(value)) { const items = [...value.values()].map(item => viruneHash(item, seen)).sort((a, b) => a - b); for (const item of items) hash = mix(hash, item); return hash; }
	if (value instanceof Map) { const pairs = [...value].map(([key, item]) => mix(viruneHash(key, seen), viruneHash(item, seen))).sort((a, b) => a - b); for (const pair of pairs) hash = mix(hash, pair); return hash; }
	if (value instanceof Set) { const items = [...value].map(item => viruneHash(item, seen)).sort((a, b) => a - b); for (const item of items) hash = mix(hash, item); return hash; }
	const record = value as Record<string, unknown>;
	for (const key of Object.keys(record).sort()) { hash = mix(hash, textHash(key)); hash = mix(hash, viruneHash(record[key], seen)); }
	return hash;
}

export function viruneEquals(left: unknown, right: unknown): boolean {
	if (Object.is(left, right)) return true;
	if (typeof left !== typeof right) return false;
	if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
	const leftTypeId = nominalTypeId(left); const rightTypeId = nominalTypeId(right);
	if (leftTypeId !== rightTypeId && (leftTypeId !== undefined || rightTypeId !== undefined)) return false;
	if (left instanceof Uint8Array && right instanceof Uint8Array) return left.length === right.length && left.every((item, index) => item === right[index]);
	if (Array.isArray(left) && Array.isArray(right)) {
		return left.length === right.length && left.every((item, index) => viruneEquals(item, right[index]));
	}
	if (isViruneMap(left) && isViruneMap(right)) {
		if (left.size !== right.size) return false;
		for (const [key, value] of left.entries()) if (!right.has(key) || !viruneEquals(value, right.get(key))) return false;
		return true;
	}
	if (isViruneSet(left) && isViruneSet(right)) {
		if (left.size !== right.size) return false;
		for (const value of left.values()) if (!right.has(value)) return false;
		return true;
	}
	if (left instanceof Map && right instanceof Map) {
		if (left.size !== right.size) return false;
		for (const [key, value] of left) {
			if (!right.has(key) || !viruneEquals(value, right.get(key))) return false;
		}
		return true;
	}
	if (left instanceof Set && right instanceof Set) {
		if (left.size !== right.size) return false;
		const remaining = [...right];
		for (const value of left) {
			const index = remaining.findIndex(candidate => viruneEquals(value, candidate));
			if (index < 0) return false;
			remaining.splice(index, 1);
		}
		return true;
	}
	const leftRecord = left as Record<string, unknown>;
	const rightRecord = right as Record<string, unknown>;
	const leftKeys = Object.keys(leftRecord);
	const rightKeys = Object.keys(rightRecord);
	return leftKeys.length === rightKeys.length && leftKeys.every(key => Object.hasOwn(rightRecord, key) && viruneEquals(leftRecord[key], rightRecord[key]));
}

export function cloneValue<T>(value: T): T {
	if (value === null || typeof value !== 'object') return value;
	if (Array.isArray(value)) return value.map(item => cloneValue(item)) as T;
	if (isViruneMap(value)) return value as T;
	if (isViruneSet(value)) return value as T;
	if (value instanceof Uint8Array) return value.slice() as T;
	if (value instanceof Map) return new Map([...value].map(([key, item]) => [cloneValue(key), cloneValue(item)])) as T;
	if (value instanceof Set) return new Set([...value].map(item => cloneValue(item))) as T;
	const result = Object.create(Object.getPrototypeOf(value) === null ? null : Object.prototype) as Record<string, unknown>;
	for (const [key, item] of Object.entries(value as Record<string, unknown>)) result[key] = cloneValue(item);
	return result as T;
}

export function resultMap<T, E, U>(value: Result<T, E>, mapper: (item: T) => U): Result<U, E> {
	return value.$tag === 'Ok' ? Ok(mapper(value.$values[0])) : value;
}

export function resultAndThen<T, E, U>(value: Result<T, E>, mapper: (item: T) => Result<U, E>): Result<U, E> {
	return value.$tag === 'Ok' ? mapper(value.$values[0]) : value;
}

export function resultOrElse<T, E, F>(value: Result<T, E>, mapper: (error: E) => Result<T, F>): Result<T, F> {
	return value.$tag === 'Err' ? mapper(value.$values[0]) : value;
}

export function resultUnwrapOr<T, E>(value: Result<T, E>, fallback: T): T {
	return value.$tag === 'Ok' ? value.$values[0] : fallback;
}

export function resultToOption<T, E>(value: Result<T, E>): Option<T> {
	return value.$tag === 'Ok' ? Some(value.$values[0]) : None;
}

export function resultCollect<T, E>(values: readonly Result<T, E>[]): Result<readonly T[], E> {
	const output: T[] = [];
	for (const value of values) {
		if (value.$tag === 'Err') return value;
		output.push(value.$values[0]);
	}
	return Ok(output);
}

export function resultCollectErrors<T, E>(values: readonly Result<T, E>[]): Result<readonly T[], readonly E[]> {
	const output: T[] = [];
	const errors: E[] = [];
	for (const value of values) {
		if (value.$tag === 'Err') errors.push(value.$values[0]);
		else output.push(value.$values[0]);
	}
	return errors.length > 0 ? Err(errors) : Ok(output);
}

export function optionAndThen<T, U>(value: Option<T>, mapper: (item: T) => Option<U>): Option<U> {
	return value.$tag === 'Some' ? mapper(value.$values[0]) : None;
}

export function optionFilter<T>(value: Option<T>, predicate: (item: T) => boolean): Option<T> {
	return value.$tag === 'Some' && predicate(value.$values[0]) ? value : None;
}

export function optionUnwrapOr<T>(value: Option<T>, fallback: T): T {
	return value.$tag === 'Some' ? value.$values[0] : fallback;
}

export function optionToResult<T, E>(value: Option<T>, error: E): Result<T, E> {
	return value.$tag === 'Some' ? Ok(value.$values[0]) : Err(error);
}

export function optionCollect<T>(values: readonly Option<T>[]): Option<readonly T[]> {
	const output: T[] = [];
	for (const value of values) {
		if (value.$tag === 'None') return None;
		output.push(value.$values[0]);
	}
	return Some(output);
}
