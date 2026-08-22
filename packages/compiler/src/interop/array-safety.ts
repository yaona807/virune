export function copyArrayByIndex<T>(values: readonly T[]): T[] {
	const result = new Array<T>(values.length);
	for (let index = 0; index < values.length; index++) result[index] = values[index]!;
	return result;
}

export function mapArrayByIndex<T, U>(values: readonly T[], mapper: (value: T, index: number) => U): U[] {
	const result = new Array<U>(values.length);
	for (let index = 0; index < values.length; index++) result[index] = mapper(values[index]!, index);
	return result;
}

export function filterArrayByIndex<T>(values: readonly T[], predicate: (value: T, index: number) => boolean): T[] {
	const result: T[] = [];
	for (let index = 0; index < values.length; index++) {
		const value = values[index]!;
		if (predicate(value, index)) result[result.length] = value;
	}
	return result;
}

export function someArrayByIndex<T>(values: readonly T[], predicate: (value: T, index: number) => boolean): boolean {
	for (let index = 0; index < values.length; index++) {
		if (predicate(values[index]!, index)) return true;
	}
	return false;
}

export function everyArrayByIndex<T>(values: readonly T[], predicate: (value: T, index: number) => boolean): boolean {
	for (let index = 0; index < values.length; index++) {
		if (!predicate(values[index]!, index)) return false;
	}
	return true;
}

export function findArrayByIndex<T>(values: readonly T[], predicate: (value: T, index: number) => boolean): T | undefined {
	for (let index = 0; index < values.length; index++) {
		const value = values[index]!;
		if (predicate(value, index)) return value;
	}
	return undefined;
}

export function sliceArrayByIndex<T>(values: readonly T[], start: number, end = values.length): T[] {
	const boundedStart = Math.max(0, Math.min(values.length, start));
	const boundedEnd = Math.max(boundedStart, Math.min(values.length, end));
	const result = new Array<T>(boundedEnd - boundedStart);
	for (let index = boundedStart; index < boundedEnd; index++) result[index - boundedStart] = values[index]!;
	return result;
}

export function sortArrayByIndex<T>(values: readonly T[], compare: (left: T, right: T) => number): T[] {
	const result = copyArrayByIndex(values);
	for (let index = 1; index < result.length; index++) {
		const value = result[index]!;
		let insertion = index;
		while (insertion > 0 && compare(result[insertion - 1]!, value) > 0) {
			result[insertion] = result[insertion - 1]!;
			insertion--;
		}
		result[insertion] = value;
	}
	return result;
}

export function uniqueArrayByIndex<T>(values: readonly T[], equals: (left: T, right: T) => boolean = (left, right) => left === right): T[] {
	const result: T[] = [];
	for (let index = 0; index < values.length; index++) {
		const value = values[index]!;
		let duplicate = false;
		for (let candidate = 0; candidate < result.length; candidate++) {
			if (equals(result[candidate]!, value)) {
				duplicate = true;
				break;
			}
		}
		if (!duplicate) result[result.length] = value;
	}
	return result;
}

export function readDenseOwnDataArray(value: unknown, description: string): readonly unknown[] {
	if (!Array.isArray(value)) throw new Error(`${description} must be an array`);
	const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
	if (
		lengthDescriptor === undefined
		|| !('value' in lengthDescriptor)
		|| typeof lengthDescriptor.value !== 'number'
		|| !Number.isSafeInteger(lengthDescriptor.value)
		|| lengthDescriptor.value < 0
	) {
		throw new Error(`${description} has an invalid length`);
	}
	const length = lengthDescriptor.value;
	const result = new Array<unknown>(length);
	const keys = Reflect.ownKeys(value);
	let indexKeyCount = 0;
	for (let keyIndex = 0; keyIndex < keys.length; keyIndex++) {
		const key = keys[keyIndex]!;
		if (typeof key === 'symbol') throw new Error(`Unknown ${description} field: ${String(key)}`);
		if (key === 'length') continue;
		const index = Number(key);
		if (!Number.isSafeInteger(index) || index < 0 || index >= length || `${index}` !== key) {
			throw new Error(`Unknown ${description} field: ${key}`);
		}
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (descriptor === undefined) throw new Error(`${description} is missing index ${index}`);
		if (!('value' in descriptor)) throw new Error(`${description} field ${index} must be a data property`);
		result[index] = descriptor.value;
		indexKeyCount++;
	}
	if (indexKeyCount !== length) throw new Error(`${description} must be a dense array without extra fields`);
	return result;
}
