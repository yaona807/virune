export type Stream<T> = AsyncIterable<T>;

export async function* fromList<T>(values: readonly T[]): Stream<T> {
	for (const value of values) yield value;
}

export async function* map<T, U>(stream: Stream<T>, mapper: (value: T) => U | Promise<U>): Stream<U> {
	for await (const value of stream) yield await mapper(value);
}

export async function* filter<T>(stream: Stream<T>, predicate: (value: T) => boolean | Promise<boolean>): Stream<T> {
	for await (const value of stream) if (await predicate(value)) yield value;
}

export async function collect<T>(stream: Stream<T>): Promise<readonly T[]> {
	const output: T[] = [];
	for await (const value of stream) output.push(value);
	return output;
}

export async function* take<T>(stream: Stream<T>, count: number): Stream<T> {
	let index = 0;
	for await (const value of stream) {
		if (index++ >= count) return;
		yield value;
	}
}
