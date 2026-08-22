function appendOwnData<T>(values: T[], value: T): void {
	Object.defineProperty(values, `${values.length}`, {
		configurable: true,
		enumerable: true,
		writable: true,
		value,
	});
}

function createOwnDataArray<T>(length: number, valueAt: (index: number) => T): T[] {
	const result: T[] = [];
	for (let index = 0; index < length; index++) appendOwnData(result, valueAt(index));
	return result;
}

export function copyArrayByIndex<T>(values: readonly T[]): T[] {
	return createOwnDataArray(values.length, index => values[index]!);
}

export function mapArrayByIndex<T, U>(values: readonly T[], mapper: (value: T, index: number) => U): U[] {
	return createOwnDataArray(values.length, index => mapper(values[index]!, index));
}

export function filterArrayByIndex<T>(values: readonly T[], predicate: (value: T, index: number) => boolean): T[] {
	const result: T[] = [];
	for (let index = 0; index < values.length; index++) {
		const value = values[index]!;
		if (predicate(value, index)) appendOwnData(result, value);
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

export function sliceArrayByIndex<T>(values: readonly T[], start: number, end = values.length): T[] {
	const boundedStart = Math.max(0, Math.min(values.length, start));
	const boundedEnd = Math.max(boundedStart, Math.min(values.length, end));
	return createOwnDataArray(boundedEnd - boundedStart, index => values[boundedStart + index]!);
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
		if (!duplicate) appendOwnData(result, value);
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
	const result: unknown[] = [];
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
		indexKeyCount++;
	}
	if (indexKeyCount !== length) throw new Error(`${description} must be a dense array without extra fields`);
	for (let index = 0; index < length; index++) {
		const descriptor = Object.getOwnPropertyDescriptor(value, `${index}`);
		if (descriptor === undefined) throw new Error(`${description} is missing index ${index}`);
		if (!('value' in descriptor)) throw new Error(`${description} field ${index} must be a data property`);
		appendOwnData(result, descriptor.value);
	}
	return result;
}
