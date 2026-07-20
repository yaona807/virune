import assert from 'node:assert/strict';
import test from 'node:test';
import { Err, None, Ok, Some, encodeFfiValue, intAdd, intDivide, listGet, parallelTry, rootTaskContext, validateFfiValue, viruneEquals } from '../src/index.js';

test('Int checks safe arithmetic', () => {
	assert.equal(intAdd(1, 2), 3);
	assert.throws(() => intDivide(1, 0), /division by zero/);
});

test('List access returns Option', () => {
	assert.deepEqual(listGet([1], 0), Some(1));
	assert.equal(listGet([1], 2).$tag, 'None');
});

test('deep equality supports records and lists', () => {
	assert.equal(viruneEquals({ a: [1, 2] }, { a: [1, 2] }), true);
});

test('parallelTry selects leftmost source error', async () => {
	const result = await parallelTry(rootTaskContext(), {
		first: async () => { await new Promise(resolve => setTimeout(resolve, 20)); return Err('first'); },
		second: async () => Err('second'),
		third: async () => Ok(3),
	});
	assert.deepEqual(result, Err('first'));
});


test('FFI conversion handles Option and records', () => {
	const descriptor = {
		kind: 'record' as const,
		name: 'User',
		fields: {
			name: { kind: 'string' as const },
			nickname: { kind: 'option' as const, value: { kind: 'string' as const } },
		},
	};
	const decoded = validateFfiValue({ name: 'Alice', nickname: null }, descriptor) as { name: string; nickname: { $tag: string } };
	assert.equal(Object.getPrototypeOf(decoded), null);
	assert.equal(decoded.nickname.$tag, 'None');
	assert.deepEqual(encodeFfiValue({ name: 'Alice', nickname: Some('Al') }, descriptor), { name: 'Alice', nickname: 'Al' });
	assert.deepEqual(encodeFfiValue({ name: 'Alice', nickname: None }, descriptor), { name: 'Alice', nickname: undefined });
});


test('FFI optional property metadata distinguishes missing and omitted values', () => {
	const descriptor = {
		kind: 'record' as const,
		name: 'OptionalUser',
		typeId: 'test:OptionalUser',
		fields: {
			name: { kind: 'string' as const },
			nickname: {
				type: { kind: 'option' as const, value: { kind: 'string' as const } },
				missingAsNone: true,
				omitWhenNone: true,
			},
		},
	};
	const decoded = validateFfiValue({ name: 'Alice' }, descriptor) as { nickname: { $tag: string } };
	assert.equal(decoded.nickname.$tag, 'None');
	assert.deepEqual(encodeFfiValue({ name: 'Alice', nickname: None }, descriptor), { name: 'Alice' });
});

test('List.uniqueBy keeps the first value for each structural key', async () => {
	const { listUniqueBy } = await import('../src/index.js');
	const values = [
		{ id: 1, name: 'first' },
		{ id: 1, name: 'duplicate' },
		{ id: 2, name: 'second' },
	];
	assert.deepEqual(listUniqueBy(values, value => value.id), [values[0], values[2]]);
});

test('FFI validation rejects unsafe integers', () => {
	assert.throws(() => validateFfiValue(Number.MAX_SAFE_INTEGER + 1, { kind: 'int' }), /does not match int/);
});

test('Map and Set operations return new collections', async () => {
	const { mapEmpty, mapHas, mapRemove, mapSet, mapSize, setAdd, setEmpty, setHas, setRemove, setSize } = await import('../src/index.js');
	const emptyMap = mapEmpty<string, number>();
	const map = mapSet(emptyMap, 'a', 1);
	assert.equal(mapSize(emptyMap), 0);
	assert.equal(mapSize(map), 1);
	assert.equal(mapHas(map, 'a'), true);
	assert.equal(mapHas(mapRemove(map, 'a'), 'a'), false);
	const emptySet = setEmpty<string>();
	const set = setAdd(emptySet, 'a');
	assert.equal(setSize(emptySet), 0);
	assert.equal(setSize(set), 1);
	assert.equal(setHas(set, 'a'), true);
	assert.equal(setHas(setRemove(set, 'a'), 'a'), false);
});

test('cloneValue and stringCodePoints preserve Virune value semantics', async () => {
	const { cloneValue, stringCodePoints } = await import('../src/index.js');
	const source = { nested: [1, 2] };
	const copy = cloneValue(source);
	assert.deepEqual(copy, source);
	assert.notEqual(copy, source);
	assert.notEqual(copy.nested, source.nested);
	assert.deepEqual(stringCodePoints('😀a'), ['😀', 'a']);
});

test('Option, Result and Validation collection helpers preserve source order', async () => {
	const { optionCollect, resultCollectErrors, validationCollect } = await import('../src/index.js');
	assert.deepEqual(optionCollect([Some(1), Some(2)]), Some([1, 2]));
	assert.equal(optionCollect([Some(1), None]).$tag, 'None');
	assert.deepEqual(resultCollectErrors<number, string>([Ok(1), Err('a'), Err('b')]), Err(['a', 'b']));
	assert.deepEqual(validationCollect<number, string>([Ok(1), Err(['first']), Err(['second'])]), Err(['first', 'second']));
});

test('Unicode string operations use code points rather than UTF-16 code units', async () => {
	const { stringAt, stringLength, stringSlice } = await import('../src/index.js');
	assert.equal(stringLength('😀a'), 2);
	assert.deepEqual(stringAt('😀a', 0), Some('😀'));
	assert.equal(stringSlice('😀ab', 0, Some(2)), '😀a');
});

test('Task timeout, retry, bounded parallelism and supervision are deterministic', async () => {
	const { durationMilliseconds, durationSeconds, taskMapParallelBuiltin, taskRetryBuiltin, taskSuperviseBuiltin, taskTimeoutBuiltin } = await import('../src/index.js');
	const context = rootTaskContext();
	const timeout = await taskTimeoutBuiltin(durationMilliseconds(5), async child => {
		await new Promise((resolve, reject) => {
			const timer = setTimeout(resolve, 50);
			child.signal.addEventListener('abort', () => { clearTimeout(timer); reject(child.signal.reason); }, { once: true });
		});
		return 1;
	}, context);
	assert.equal(timeout.$tag, 'Err');

	let attempts = 0;
	const retry = await taskRetryBuiltin<number, string>(3, durationMilliseconds(0), async () => {
		attempts++;
		return attempts < 3 ? Err('retry') : Ok(7);
	}, context);
	assert.deepEqual(retry, Ok(7));

	let active = 0;
	let maximum = 0;
	const mapped = await taskMapParallelBuiltin([1, 2, 3, 4], 2, async value => {
		active++;
		maximum = Math.max(maximum, active);
		await new Promise(resolve => setTimeout(resolve, 5));
		active--;
		return value * 2;
	}, context);
	assert.deepEqual(mapped, [2, 4, 6, 8]);
	assert.equal(maximum, 2);

	let restarts = 0;
	const supervised = await taskSuperviseBuiltin(3, durationSeconds(1), durationMilliseconds(0), async restart => {
		restarts = restart;
		if (restart < 2) throw new Error('restart');
		return 9;
	}, context);
	assert.deepEqual(supervised, Ok(9));
	assert.equal(restarts, 2);
});

test('Stream pipelines remain lazy until collected', async () => {
	const { streamCollect, streamFilter, streamFromList, streamMap, streamTake } = await import('../src/index.js');
	const stream = streamTake(streamFilter(streamMap(streamFromList([1, 2, 3, 4]), value => value * 2), value => value > 4), 1);
	assert.deepEqual(await streamCollect(stream), [6]);
});

test('resource cleanup preserves the primary failure and all cleanup failures', async () => {
	const { ResourceCleanupError, runDefers, runDefersAsync } = await import('../src/index.js');
	const primary = new Error('primary');
	assert.throws(
		() => runDefers([
			() => { throw new Error('first'); },
			() => { throw new Error('second'); },
		], primary),
		(error: unknown) => error instanceof ResourceCleanupError && error.primary === primary && error.cleanupErrors.map(String).join('|').includes('second'),
	);
	await assert.rejects(
		runDefersAsync([
			async () => { throw new Error('async'); },
		], primary),
		(error: unknown) => error instanceof ResourceCleanupError && error.primary === primary && error.cleanupErrors.length === 1,
	);
});

test('Task.race observes first settlement while Task.firstOk observes first fulfillment', async () => {
	const { taskFirstOk, taskRace } = await import('../src/index.js');
	const context = rootTaskContext();
	await assert.rejects(taskRace(context, [
		async () => { throw new Error('first failure'); },
		async () => { await new Promise(resolve => setTimeout(resolve, 10)); return 2; },
	]), /first failure/);
	assert.equal(await taskFirstOk(context, [
		async () => { throw new Error('ignored failure'); },
		async () => 3,
	]), 3);
});

test('Task.parallel cancels siblings, waits for settlement, and reports the leftmost rejection', async () => {
	const { parallel } = await import('../src/index.js');
	const events: string[] = [];
	await assert.rejects(parallel(rootTaskContext(), {
		first: async child => {
			await new Promise<void>((resolve, reject) => {
				const timer = setTimeout(() => { events.push('first-failed'); reject(new Error('first')); }, 5);
				child.signal.addEventListener('abort', () => { clearTimeout(timer); events.push('first-aborted'); reject(child.signal.reason); }, { once: true });
			});
		},
		second: async child => {
			await new Promise<void>((resolve, reject) => {
				const timer = setTimeout(() => { events.push('second-complete'); resolve(); }, 100);
				child.signal.addEventListener('abort', () => { clearTimeout(timer); events.push('second-aborted'); reject(new Error('second')); }, { once: true });
			});
		},
	}), /first/);
	assert.equal(events[0], 'first-failed');
	assert.equal(events.includes('second-aborted'), true);
});

test('Task timeout and retry reject invalid timer ranges', async () => {
	const { durationMilliseconds, retry, withTimeout } = await import('../src/index.js');
	const context = rootTaskContext();
	await assert.rejects(withTimeout(context, Number.POSITIVE_INFINITY, async () => 1), /finite value/);
	await assert.rejects(retry(context, {
		attempts: 2,
		delay: durationMilliseconds(1),
		backoffFactor: Number.POSITIVE_INFINITY,
	}, async () => Err('retry')), /finite non-negative number/);
});

test('Bytes and MutableBytes support binary round-trips without aliasing', async () => {
	const {
		bytesFromHex,
		bytesReadInt32,
		bytesToHex,
		bytesWriteInt32,
		mutableBytesFromBytes,
		mutableBytesSet,
		mutableBytesToBytes,
	} = await import('../src/index.js');
	const source = bytesFromHex('00000000');
	assert.equal(source.$tag, 'Ok');
	if (source.$tag !== 'Ok') return;
	const written = bytesWriteInt32(source.$values[0], 0, 0x1020304, 'BigEndian');
	assert.equal(written.$tag, 'Ok');
	if (written.$tag !== 'Ok') return;
	assert.equal(bytesToHex(written.$values[0]), '01020304');
	assert.deepEqual(bytesReadInt32(written.$values[0], 0, 'BigEndian'), Ok(0x1020304));
	const mutable = mutableBytesFromBytes(written.$values[0]);
	assert.deepEqual(mutableBytesSet(mutable, 0, 255), Ok(undefined));
	const frozen = mutableBytesToBytes(mutable);
	assert.equal(bytesToHex(frozen), 'ff020304');
	mutable[0] = 0;
	assert.equal(bytesToHex(frozen), 'ff020304');
});

test('Unicode grapheme and normalization APIs distinguish code points from user-perceived characters', async () => {
	const { stringGraphemeLength, stringGraphemes, stringNormalizeNfc, stringNormalizeNfd } = await import('../src/index.js');
	assert.equal(stringGraphemeLength('👨‍👩‍👧‍👦'), 1);
	assert.deepEqual(stringGraphemes('e\u0301'), ['e\u0301']);
	assert.equal(stringNormalizeNfc('e\u0301'), 'é');
	assert.equal(stringNormalizeNfd('é'), 'e\u0301');
});

test('fixed-width integer constructors enforce exact ranges', async () => {
	const { int8Create, int64Create, uint8Create, uint64Create } = await import('../src/index.js');
	assert.deepEqual(int8Create(-128), Ok(-128));
	assert.equal(int8Create(128).$tag, 'Err');
	assert.deepEqual(uint8Create(255), Ok(255));
	assert.equal(uint8Create(-1).$tag, 'Err');
	assert.deepEqual(int64Create((1n << 63n) - 1n), Ok((1n << 63n) - 1n));
	assert.equal(int64Create(1n << 63n).$tag, 'Err');
	assert.deepEqual(uint64Create((1n << 64n) - 1n), Ok((1n << 64n) - 1n));
	assert.equal(uint64Create(1n << 64n).$tag, 'Err');
});

test('Virune Map and Set use structural equality and nominal type identity', async () => {
	const { makeRecord, mapGet, mapSet, mapEmpty, setFrom, setHas } = await import('../src/index.js');
	const first = makeRecord({ value: 'A' }, 'test:Key');
	const same = makeRecord({ value: 'A' }, 'test:Key');
	const otherType = makeRecord({ value: 'A' }, 'test:OtherKey');
	assert.equal(setHas(setFrom([first]), same), true);
	assert.equal(setHas(setFrom([first]), otherType), false);
	assert.deepEqual(mapGet(mapSet(mapEmpty(), first, 7), same), Some(7));
});

test('JSON and FFI preserve Bytes, collection semantics, and nominal runtime type IDs', async () => {
	const { decodeJsonValue, encodeJsonValue, validateFfiValue } = await import('../src/index.js');
	const descriptor = {
		kind: 'record' as const,
		name: 'Payload',
		typeId: 'test:Payload',
		fields: {
			data: { kind: 'bytes' as const },
			labels: { kind: 'set' as const, item: { kind: 'string' as const } },
		},
	};
	const decoded = decodeJsonValue({ data: 'QQ==', labels: ['a', 'a'] }, descriptor);
	assert.equal(decoded.$tag, 'Ok');
	if (decoded.$tag !== 'Ok') return;
	const value = decoded.$values[0] as { readonly data: Uint8Array; readonly labels: ReadonlySet<string>; readonly $type?: string };
	assert.equal(value.$type, 'test:Payload');
	assert.deepEqual([...value.data], [65]);
	assert.equal(value.labels.size, 1);
	const encoded = encodeJsonValue(value, descriptor);
	assert.equal(encoded.$tag, 'Ok');
	if (encoded.$tag === 'Ok') assert.deepEqual(JSON.parse(encoded.$values[0]), { data: 'QQ==', labels: ['a'] });
	const ffi = validateFfiValue({ data: new Uint8Array([65]), labels: new Set(['x']) }, descriptor) as { readonly $type?: string };
	assert.equal(ffi.$type, 'test:Payload');
});

test('nominal runtime types remain distinct and hashed collections preserve insertion order', async () => {
	const { makeRecord, mapEmpty, mapEntries, mapGet, mapSet, viruneEquals: equals } = await import('../src/index.js');
	const leftType = makeRecord({ value: 1 }, 'test:Left');
	const rightType = makeRecord({ value: 1 }, 'test:Right');
	assert.equal(equals(leftType, rightType), false);

	const first = makeRecord({ id: 1 }, 'test:Key');
	const second = makeRecord({ id: 2 }, 'test:Key');
	const third = makeRecord({ id: 3 }, 'test:Key');
	let map = mapEmpty();
	map = mapSet(map, first, 'first');
	map = mapSet(map, second, 'second');
	map = mapSet(map, third, 'third');
	assert.deepEqual(mapEntries(map).map(([key]) => (key as { id: number }).id), [1, 2, 3]);
	assert.deepEqual(mapGet(map, makeRecord({ id: 2 }, 'test:Key')), Some('second'));
});

test('Task.timeout cancels and settles the child before returning', async () => {
	const { durationMilliseconds, taskTimeoutBuiltin } = await import('../src/index.js');
	let aborted = false;
	let settled = false;
	const startedAt = Date.now();
	const result = await taskTimeoutBuiltin(durationMilliseconds(5), async child => {
		await new Promise<void>((_resolve, reject) => {
			child.signal.addEventListener('abort', () => {
				aborted = true;
				setTimeout(() => {
					settled = true;
					reject(child.signal.reason);
				}, 15);
			}, { once: true });
		});
	}, rootTaskContext());
	assert.equal(result.$tag, 'Err');
	assert.equal(aborted, true);
	assert.equal(settled, true);
	assert.ok(Date.now() - startedAt >= 15);
});

test('Task.mapParallel cancels siblings and waits for their cleanup', async () => {
	const { taskMapParallelBuiltin } = await import('../src/index.js');
	let siblingAborted = false;
	let siblingSettled = false;
	await assert.rejects(taskMapParallelBuiltin([0, 1], 2, async (_value, index, child) => {
		if (index === 1) {
			await new Promise(resolve => setTimeout(resolve, 5));
			throw new Error('mapper failed');
		}
		return await new Promise<number>((_resolve, reject) => {
			child.signal.addEventListener('abort', () => {
				siblingAborted = true;
				setTimeout(() => {
					siblingSettled = true;
					reject(child.signal.reason);
				}, 15);
			}, { once: true });
		});
	}, rootTaskContext()), /mapper failed/u);
	assert.equal(siblingAborted, true);
	assert.equal(siblingSettled, true);
});

test('Task.race observes synchronous failures after starting all siblings', async () => {
	const { taskRace } = await import('../src/index.js');
	let siblingStarted = false;
	await assert.rejects(taskRace(rootTaskContext(), [
		() => { throw new Error('synchronous failure'); },
		async child => {
			siblingStarted = true;
			await new Promise<void>((_resolve, reject) => child.signal.addEventListener('abort', () => reject(child.signal.reason), { once: true }));
		},
	]), /synchronous failure/u);
	assert.equal(siblingStarted, true);
});

test('FFI decoder rejects getters, cycles, sparse arrays, and class instances', () => {
	const getter = Object.defineProperty({}, 'name', { enumerable: true, get: () => 'Alice' });
	assert.throws(() => validateFfiValue(getter, { kind: 'record', name: 'User', fields: { name: { kind: 'string' } } }), /accessor properties are not accepted/);
	const cycle: unknown[] = [];
	cycle.push(cycle);
	assert.throws(() => validateFfiValue(cycle, { kind: 'list', item: { kind: 'list', item: { kind: 'unknown' } } }), /cyclic value is not supported/);
	const sparse = new Array(2); sparse[1] = 'x';
	assert.throws(() => validateFfiValue(sparse, { kind: 'list', item: { kind: 'string' } }), /sparse arrays are not supported/);
	class User { public name = 'Alice'; }
	assert.throws(() => validateFfiValue(new User(), { kind: 'record', name: 'User', fields: { name: { kind: 'string' } } }), /does not match record/);
});

test('FFI encoder defines __proto__ as a normal own property', () => {
	const fields = Object.create(null) as Record<string, { readonly kind: 'string' }>;
	Object.defineProperty(fields, '__proto__', { value: { kind: 'string' as const }, enumerable: true });
	const value = Object.create(null) as Record<string, unknown>;
	Object.defineProperty(value, '__proto__', { value: 'safe', enumerable: true });
	const descriptor = { kind: 'record' as const, name: 'Payload', fields };
	const encoded = encodeFfiValue(value, descriptor) as Record<string, unknown>;
	assert.equal(Object.getPrototypeOf(encoded), Object.prototype);
	assert.equal(Object.hasOwn(encoded, '__proto__'), true);
	assert.equal(encoded.__proto__, 'safe');
});
