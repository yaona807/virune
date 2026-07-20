import { Err, None, Ok, Some, type Option, type Result, viruneEquals, viruneHash } from './core.js';

export interface IndexError { readonly kind: 'IndexError'; readonly index: number; readonly length: number; }

interface MapEntry<K, V> { readonly key: K; readonly value: V; readonly hash: number; }

export class ViruneMap<K, V> implements ReadonlyMap<K, V> {
	public readonly $viruneCollection = 'Map' as const;
	readonly #buckets: ReadonlyMap<number, readonly MapEntry<K, V>[]>;
	readonly #ordered: readonly MapEntry<K, V>[];
	public readonly size: number;
	public constructor(entries: Iterable<readonly [K, V]> = []) {
		const ordered: MapEntry<K, V>[] = [];
		for (const [key, value] of entries) {
			const hash = viruneHash(key);
			const index = ordered.findIndex(entry => entry.hash === hash && viruneEquals(entry.key, key));
			const next = { key, value, hash };
			if (index >= 0) ordered[index] = next;
			else ordered.push(next);
		}
		const buckets = new Map<number, MapEntry<K, V>[]>();
		for (const entry of ordered) {
			const bucket = buckets.get(entry.hash) ?? [];
			bucket.push(entry);
			buckets.set(entry.hash, bucket);
		}
		this.#ordered = ordered;
		this.#buckets = buckets;
		this.size = ordered.length;
	}
	public get(key: K): V | undefined { return this.#buckets.get(viruneHash(key))?.find(entry => viruneEquals(entry.key, key))?.value; }
	public has(key: K): boolean { return this.#buckets.get(viruneHash(key))?.some(entry => viruneEquals(entry.key, key)) === true; }
	public entries(): MapIterator<[K, V]> { return new Map(this.#ordered.map(entry => [entry.key, entry.value])).entries(); }
	public keys(): MapIterator<K> { return new Map(this.#ordered.map(entry => [entry.key, entry.value])).keys(); }
	public values(): MapIterator<V> { return new Map(this.#ordered.map(entry => [entry.key, entry.value])).values(); }
	public forEach(callbackfn: (value: V, key: K, map: ReadonlyMap<K, V>) => void, thisArg?: unknown): void { for (const [key, value] of this) callbackfn.call(thisArg, value, key, this); }
	public [Symbol.iterator](): MapIterator<[K, V]> { return this.entries(); }
}

export class ViruneSet<T> implements ReadonlySet<T> {
	public readonly $viruneCollection = 'Set' as const;
	readonly #map: ViruneMap<T, true>;
	public constructor(values: Iterable<T> = []) { this.#map = new ViruneMap(Array.from(values, value => [value, true] as const)); }
	public get size(): number { return this.#map.size; }
	public has(value: T): boolean { return this.#map.has(value); }
	public entries(): SetIterator<[T, T]> { return new Set(this.values()).entries(); }
	public keys(): SetIterator<T> { return this.values(); }
	public values(): SetIterator<T> { return new Set([...this.#map.keys()]).values(); }
	public forEach(callbackfn: (value: T, value2: T, set: ReadonlySet<T>) => void, thisArg?: unknown): void { for (const value of this) callbackfn.call(thisArg, value, value, this); }
	public [Symbol.iterator](): SetIterator<T> { return this.values(); }
}

export const listLength = <T>(values: readonly T[]): number => values.length;
export const listIsEmpty = <T>(values: readonly T[]): boolean => values.length === 0;
export const listIsNotEmpty = <T>(values: readonly T[]): boolean => values.length > 0;
export function listGet<T>(values: readonly T[], index: number): Option<T> { return Number.isSafeInteger(index) && index >= 0 && index < values.length ? Some(values[index] as T) : None; }
export function listSet<T>(values: readonly T[], index: number, value: T): Result<readonly T[], IndexError> { if (!Number.isSafeInteger(index) || index < 0 || index >= values.length) return Err({ kind: 'IndexError', index, length: values.length }); const next = values.slice(); next[index] = value; return Ok(next); }
export const listAppend = <T>(values: readonly T[], value: T): readonly T[] => [...values, value];
export const listMap = <T, U>(values: readonly T[], mapper: (value: T) => U): readonly U[] => values.map(mapper);
export const listFilter = <T>(values: readonly T[], predicate: (value: T) => boolean): readonly T[] => values.filter(predicate);
export const listFirst = <T>(values: readonly T[]): Option<T> => listGet(values, 0);
export const mapEmpty = <K, V>(): ReadonlyMap<K, V> => new ViruneMap<K, V>();
export const mapSet = <K, V>(map: ReadonlyMap<K, V>, key: K, value: V): ReadonlyMap<K, V> => new ViruneMap([...map, [key, value] as const]);
export const mapGet = <K, V>(map: ReadonlyMap<K, V>, key: K): Option<V> => map.has(key) ? Some(map.get(key) as V) : None;
export const setFrom = <T>(values: readonly T[]): ReadonlySet<T> => new ViruneSet(values);
export const mapHas = <K, V>(map: ReadonlyMap<K, V>, key: K): boolean => map.has(key);
export const mapRemove = <K, V>(map: ReadonlyMap<K, V>, key: K): ReadonlyMap<K, V> => new ViruneMap([...map].filter(([candidate]) => !viruneEquals(candidate, key)));
export const mapSize = <K, V>(map: ReadonlyMap<K, V>): number => map.size;
export const setEmpty = <T>(): ReadonlySet<T> => new ViruneSet<T>();
export const setAdd = <T>(set: ReadonlySet<T>, value: T): ReadonlySet<T> => new ViruneSet([...set, value]);
export const setHas = <T>(set: ReadonlySet<T>, value: T): boolean => set.has(value);
export const setRemove = <T>(set: ReadonlySet<T>, value: T): ReadonlySet<T> => new ViruneSet([...set].filter(candidate => !viruneEquals(candidate, value)));
export const setSize = <T>(set: ReadonlySet<T>): number => set.size;
export const stringCodePoints = (value: string): readonly string[] => [...value];
export const listPrepend = <T>(values: readonly T[], value: T): readonly T[] => [value, ...values];
export const listConcat = <T>(left: readonly T[], right: readonly T[]): readonly T[] => [...left, ...right];
export const listLast = <T>(values: readonly T[]): Option<T> => listGet(values, values.length - 1);
export const listTake = <T>(values: readonly T[], count: number): readonly T[] => values.slice(0, Math.max(0, count));
export const listDrop = <T>(values: readonly T[], count: number): readonly T[] => values.slice(Math.max(0, count));
export const listReverse = <T>(values: readonly T[]): readonly T[] => [...values].reverse();
export const listSort = <T>(values: readonly T[], compare: (left: T, right: T) => number): readonly T[] => [...values].sort(compare);
export const listFind = <T>(values: readonly T[], predicate: (value: T) => boolean): Option<T> => { const value = values.find(predicate); return value === undefined ? None : Some(value); };
export const listAny = <T>(values: readonly T[], predicate: (value: T) => boolean): boolean => values.some(predicate);
export const listAll = <T>(values: readonly T[], predicate: (value: T) => boolean): boolean => values.every(predicate);
export const listFold = <T, U>(values: readonly T[], initial: U, reducer: (state: U, value: T) => U): U => values.reduce(reducer, initial);
export const listFlatMap = <T, U>(values: readonly T[], mapper: (value: T) => readonly U[]): readonly U[] => values.flatMap(mapper);
export function listZip<T, U>(left: readonly T[], right: readonly U[]): readonly (readonly [T, U])[] { const length = Math.min(left.length, right.length); return Array.from({ length }, (_, index) => [left[index] as T, right[index] as U] as const); }
export const listEnumerate = <T>(values: readonly T[]): readonly (readonly [number, T])[] => values.map((value, index) => [index, value] as const);
export const listUnique = <T>(values: readonly T[]): readonly T[] => [...new ViruneSet(values)];
export function listUniqueBy<T, K>(values: readonly T[], key: (value: T) => K): readonly T[] {
	const keys: K[] = [];
	return values.filter(value => {
		const candidate = key(value);
		if (keys.some(existing => viruneEquals(existing, candidate))) return false;
		keys.push(candidate);
		return true;
	});
}

export const mapKeys = <K, V>(map: ReadonlyMap<K, V>): readonly K[] => [...map.keys()];
export const mapValues = <K, V>(map: ReadonlyMap<K, V>): readonly V[] => [...map.values()];
export const mapEntries = <K, V>(map: ReadonlyMap<K, V>): readonly (readonly [K, V])[] => [...map.entries()];
export const mapMerge = <K, V>(left: ReadonlyMap<K, V>, right: ReadonlyMap<K, V>): ReadonlyMap<K, V> => new ViruneMap([...left, ...right]);
export const mapMapValues = <K, V, U>(map: ReadonlyMap<K, V>, mapper: (value: V, key: K) => U): ReadonlyMap<K, U> => new ViruneMap([...map].map(([key, value]) => [key, mapper(value, key)] as const));
export const setToList = <T>(set: ReadonlySet<T>): readonly T[] => [...set];
export const setUnion = <T>(left: ReadonlySet<T>, right: ReadonlySet<T>): ReadonlySet<T> => new ViruneSet([...left, ...right]);
export const setIntersection = <T>(left: ReadonlySet<T>, right: ReadonlySet<T>): ReadonlySet<T> => new ViruneSet([...left].filter(value => right.has(value)));
export const setDifference = <T>(left: ReadonlySet<T>, right: ReadonlySet<T>): ReadonlySet<T> => new ViruneSet([...left].filter(value => !right.has(value)));
export const queueEmpty = <T>(): readonly T[] => [];
export const queueEnqueue = <T>(queue: readonly T[], value: T): readonly T[] => [...queue, value];
export const queueDequeue = <T>(queue: readonly T[]): Option<readonly [T, readonly T[]]> => queue.length === 0 ? None : Some([queue[0] as T, queue.slice(1)] as const);
export const stackEmpty = <T>(): readonly T[] => [];
export const stackPush = <T>(stack: readonly T[], value: T): readonly T[] => [...stack, value];
export const stackPop = <T>(stack: readonly T[]): Option<readonly [T, readonly T[]]> => stack.length === 0 ? None : Some([stack.at(-1) as T, stack.slice(0, -1)] as const);
