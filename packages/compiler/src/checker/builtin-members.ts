import type { TypeId } from '../source.js';
import { TypeArena } from '../types/types.js';

export function builtinMember(arena: TypeArena, namedTypes: ReadonlyMap<string, TypeId>, namespace: string, member: string): TypeId | undefined {
	const t = arena.variable('T'); const u = arena.variable('U'); const e = arena.variable('E'); const f = arena.variable('F');
	const jsonError = namedTypes.get('JsonError') ?? arena.error;
	const jsonErrors = arena.list(jsonError);
	const duration = namedTypes.get('Duration') ?? arena.error;
	const timeoutError = namedTypes.get('TaskTimeoutError') ?? arena.error;
	const supervisorError = namedTypes.get('SupervisorRestartLimitError') ?? arena.error;
	const httpResponse = namedTypes.get('HttpResponse') ?? arena.error;
	const jsError = namedTypes.get('JsError') ?? arena.error;
	const fileHandle = namedTypes.get('FileHandle') ?? arena.error;
	const bytes = namedTypes.get('Bytes') ?? arena.error;
	const mutableBytes = namedTypes.get('MutableBytes') ?? arena.error;
	const byteOrder = namedTypes.get('ByteOrder') ?? arena.error;
	const bytesError = namedTypes.get('BytesError') ?? arena.error;
	const integerRangeError = namedTypes.get('IntegerRangeError') ?? arena.error;
	const httpBody = namedTypes.get('HttpBody') ?? arena.error;
	const streamT = arena.add({ kind: 'named', name: 'Stream', definitionId: 'std:Stream', declarationKind: 'alias', arguments: [t] });
	const streamU = arena.add({ kind: 'named', name: 'Stream', definitionId: 'std:Stream', declarationKind: 'alias', arguments: [u] });
	const table: Record<string, Record<string, TypeId>> = {
		Console: { print: arena.function([arena.string], arena.unit, [], false, ['Console']) },
		Int: { toFloat: arena.function([arena.int], arena.float) },
		Float: { toInt: arena.function([arena.float], arena.result(arena.int, arena.unknown)) },
		Duration: {
			milliseconds: arena.function([arena.int], duration), seconds: arena.function([arena.int], duration),
			minutes: arena.function([arena.int], duration), hours: arena.function([arena.int], duration),
			toMilliseconds: arena.function([duration], arena.int),
		},
		List: {
			length: arena.function([arena.list(t)], arena.int, ['T']), isEmpty: arena.function([arena.list(t)], arena.bool, ['T']),
			isNotEmpty: arena.function([arena.list(t)], arena.bool, ['T']), first: arena.function([arena.list(t)], arena.option(t), ['T']),
			last: arena.function([arena.list(t)], arena.option(t), ['T']), get: arena.function([arena.list(t), arena.int], arena.option(t), ['T']),
			append: arena.function([arena.list(t), t], arena.list(t), ['T']), prepend: arena.function([arena.list(t), t], arena.list(t), ['T']),
			concat: arena.function([arena.list(t), arena.list(t)], arena.list(t), ['T']), take: arena.function([arena.list(t), arena.int], arena.list(t), ['T']),
			drop: arena.function([arena.list(t), arena.int], arena.list(t), ['T']), reverse: arena.function([arena.list(t)], arena.list(t), ['T']),
			map: arena.function([arena.list(t), arena.function([t], u)], arena.list(u), ['T', 'U']),
			flatMap: arena.function([arena.list(t), arena.function([t], arena.list(u))], arena.list(u), ['T', 'U']),
			filter: arena.function([arena.list(t), arena.function([t], arena.bool)], arena.list(t), ['T']),
			find: arena.function([arena.list(t), arena.function([t], arena.bool)], arena.option(t), ['T']),
			any: arena.function([arena.list(t), arena.function([t], arena.bool)], arena.bool, ['T']),
			all: arena.function([arena.list(t), arena.function([t], arena.bool)], arena.bool, ['T']),
			fold: arena.function([arena.list(t), u, arena.function([u, t], u)], u, ['T', 'U']),
			zip: arena.function([arena.list(t), arena.list(u)], arena.list(arena.tuple([t, u])), ['T', 'U']),
			enumerate: arena.function([arena.list(t)], arena.list(arena.tuple([arena.int, t])), ['T']),
			unique: arena.function([arena.list(t)], arena.list(t), ['T']),
			uniqueBy: arena.function([arena.list(t), arena.function([t], u)], arena.list(t), ['T', 'U']),
		},
		Map: {
			empty: arena.function([], arena.map(t, u), ['T', 'U']), get: arena.function([arena.map(t, u), t], arena.option(u), ['T', 'U']),
			set: arena.function([arena.map(t, u), t, u], arena.map(t, u), ['T', 'U']), has: arena.function([arena.map(t, u), t], arena.bool, ['T', 'U']),
			remove: arena.function([arena.map(t, u), t], arena.map(t, u), ['T', 'U']), size: arena.function([arena.map(t, u)], arena.int, ['T', 'U']),
			keys: arena.function([arena.map(t, u)], arena.list(t), ['T', 'U']), values: arena.function([arena.map(t, u)], arena.list(u), ['T', 'U']),
			entries: arena.function([arena.map(t, u)], arena.list(arena.tuple([t, u])), ['T', 'U']),
			merge: arena.function([arena.map(t, u), arena.map(t, u)], arena.map(t, u), ['T', 'U']),
			mapValues: arena.function([arena.map(t, u), arena.function([u, t], f)], arena.map(t, f), ['T', 'U', 'F']),
		},
		Set: {
			empty: arena.function([], arena.set(t), ['T']), from: arena.function([arena.list(t)], arena.set(t), ['T']),
			add: arena.function([arena.set(t), t], arena.set(t), ['T']), has: arena.function([arena.set(t), t], arena.bool, ['T']),
			remove: arena.function([arena.set(t), t], arena.set(t), ['T']), size: arena.function([arena.set(t)], arena.int, ['T']),
			toList: arena.function([arena.set(t)], arena.list(t), ['T']), union: arena.function([arena.set(t), arena.set(t)], arena.set(t), ['T']),
			intersection: arena.function([arena.set(t), arena.set(t)], arena.set(t), ['T']), difference: arena.function([arena.set(t), arena.set(t)], arena.set(t), ['T']),
		},
		Queue: {
			empty: arena.function([], arena.list(t), ['T']), enqueue: arena.function([arena.list(t), t], arena.list(t), ['T']),
			dequeue: arena.function([arena.list(t)], arena.option(arena.tuple([t, arena.list(t)])), ['T']),
		},
		Stack: {
			empty: arena.function([], arena.list(t), ['T']), push: arena.function([arena.list(t), t], arena.list(t), ['T']),
			pop: arena.function([arena.list(t)], arena.option(arena.tuple([t, arena.list(t)])), ['T']),
		},
		String: {
			codePoints: arena.function([arena.string], arena.list(arena.string)), graphemes: arena.function([arena.string], arena.list(arena.string)), length: arena.function([arena.string], arena.int), graphemeLength: arena.function([arena.string], arena.int),
			trim: arena.function([arena.string], arena.string), trimStart: arena.function([arena.string], arena.string), trimEnd: arena.function([arena.string], arena.string),
			contains: arena.function([arena.string, arena.string], arena.bool), startsWith: arena.function([arena.string, arena.string], arena.bool),
			endsWith: arena.function([arena.string, arena.string], arena.bool), toLowerCase: arena.function([arena.string], arena.string),
			toUpperCase: arena.function([arena.string], arena.string), split: arena.function([arena.string, arena.string], arena.list(arena.string)),
			join: arena.function([arena.list(arena.string), arena.string], arena.string), replace: arena.function([arena.string, arena.string, arena.string], arena.string),
			slice: arena.function([arena.string, arena.int, arena.option(arena.int)], arena.string),
			at: arena.function([arena.string, arena.int], arena.option(arena.string)), normalizeNfc: arena.function([arena.string], arena.string), normalizeNfd: arena.function([arena.string], arena.string), normalizeNfkc: arena.function([arena.string], arena.string), normalizeNfkd: arena.function([arena.string], arena.string), isEmpty: arena.function([arena.string], arena.bool), isNotEmpty: arena.function([arena.string], arena.bool),
		},
		Bytes: {
			empty: arena.function([], bytes), length: arena.function([bytes], arena.int), fromUtf8: arena.function([arena.string], bytes), toUtf8: arena.function([bytes], arena.result(arena.string, bytesError)),
			fromHex: arena.function([arena.string], arena.result(bytes, bytesError)), toHex: arena.function([bytes], arena.string), fromBase64: arena.function([arena.string], arena.result(bytes, bytesError)), toBase64: arena.function([bytes], arena.string),
			concat: arena.function([bytes, bytes], bytes), slice: arena.function([bytes, arena.int, arena.int], bytes), get: arena.function([bytes, arena.int], arena.result(namedTypes.get('Byte') ?? arena.error, bytesError)),
			set: arena.function([bytes, arena.int, namedTypes.get('Byte') ?? arena.error], arena.result(bytes, bytesError)), readInt32: arena.function([bytes, arena.int, byteOrder], arena.result(namedTypes.get('Int32') ?? arena.error, bytesError)), writeInt32: arena.function([bytes, arena.int, namedTypes.get('Int32') ?? arena.error, byteOrder], arena.result(bytes, bytesError)),
		},
		MutableBytes: {
			create: arena.function([arena.int], arena.result(mutableBytes, bytesError)), fromBytes: arena.function([bytes], mutableBytes), toBytes: arena.function([mutableBytes], bytes),
			length: arena.function([mutableBytes], arena.int), get: arena.function([mutableBytes, arena.int], arena.result(namedTypes.get('Byte') ?? arena.error, bytesError)),
			set: arena.function([mutableBytes, arena.int, namedTypes.get('Byte') ?? arena.error], arena.result(arena.unit, bytesError)), fill: arena.function([mutableBytes, namedTypes.get('Byte') ?? arena.error], arena.result(arena.unit, bytesError)),
		},
		ByteOrder: { BigEndian: byteOrder, LittleEndian: byteOrder },
		HttpBody: { Empty: httpBody, Text: arena.function([arena.string], httpBody), Bytes: arena.function([bytes], httpBody) },
		...Object.fromEntries(['Byte', 'Int8', 'UInt8', 'Int16', 'UInt16', 'Int32', 'UInt32'].map(name => [name, { fromInt: arena.function([arena.int], arena.result(namedTypes.get(name) ?? arena.error, integerRangeError)), toInt: arena.function([namedTypes.get(name) ?? arena.error], arena.int) }])),
		...Object.fromEntries(['Int64', 'UInt64'].map(name => [name, { fromBigInt: arena.function([arena.bigint], arena.result(namedTypes.get(name) ?? arena.error, integerRangeError)), toBigInt: arena.function([namedTypes.get(name) ?? arena.error], arena.bigint) }])),
		Debug: { format: arena.function([t], arena.string, ['T']) },
		Option: {
			map: arena.function([arena.option(t), arena.function([t], u)], arena.option(u), ['T', 'U']),
			andThen: arena.function([arena.option(t), arena.function([t], arena.option(u))], arena.option(u), ['T', 'U']),
			filter: arena.function([arena.option(t), arena.function([t], arena.bool)], arena.option(t), ['T']),
			unwrapOr: arena.function([arena.option(t), t], t, ['T']), toResult: arena.function([arena.option(t), e], arena.result(t, e), ['T', 'E']),
			collect: arena.function([arena.list(arena.option(t))], arena.option(arena.list(t)), ['T']),
		},
		Result: {
			map: arena.function([arena.result(t, e), arena.function([t], u)], arena.result(u, e), ['T', 'E', 'U']),
			mapError: arena.function([arena.result(t, e), arena.function([e], u)], arena.result(t, u), ['T', 'E', 'U']),
			andThen: arena.function([arena.result(t, e), arena.function([t], arena.result(u, e))], arena.result(u, e), ['T', 'E', 'U']),
			orElse: arena.function([arena.result(t, e), arena.function([e], arena.result(t, f))], arena.result(t, f), ['T', 'E', 'F']),
			unwrapOr: arena.function([arena.result(t, e), t], t, ['T', 'E']), toOption: arena.function([arena.result(t, e)], arena.option(t), ['T', 'E']),
			collect: arena.function([arena.list(arena.result(t, e))], arena.result(arena.list(t), e), ['T', 'E']),
			collectErrors: arena.function([arena.list(arena.result(t, e))], arena.result(arena.list(t), arena.list(e)), ['T', 'E']),
		},
		Validation: {
			valid: arena.function([t], arena.result(t, arena.list(e)), ['T', 'E']), invalid: arena.function([e], arena.result(t, arena.list(e)), ['T', 'E']),
			map: arena.function([arena.result(t, arena.list(e)), arena.function([t], u)], arena.result(u, arena.list(e)), ['T', 'E', 'U']),
			andThen: arena.function([arena.result(t, arena.list(e)), arena.function([t], arena.result(u, arena.list(e)))], arena.result(u, arena.list(e)), ['T', 'E', 'U']),
			collect: arena.function([arena.list(arena.result(t, arena.list(e)))], arena.result(arena.list(t), arena.list(e)), ['T', 'E']),
		},
		Task: {
			sleep: arena.function([duration], arena.unit, [], true, ['Task']),
			timeout: arena.function([duration, arena.function([], t, [], true, ['*'])], arena.result(t, timeoutError), ['T'], true, ['Task']),
			race: arena.function([arena.list(arena.function([], t, [], true, ['*']))], t, ['T'], true, ['Task']),
			firstOk: arena.function([arena.list(arena.function([], t, [], true, ['*']))], t, ['T'], true, ['Task']),
			retry: arena.function([arena.int, duration, arena.function([arena.int], arena.result(t, e), [], true, ['*'])], arena.result(t, e), ['T', 'E'], true, ['Task']),
			mapParallel: arena.function([arena.list(t), arena.int, arena.function([t, arena.int], u, [], true, ['*'])], arena.list(u), ['T', 'U'], true, ['Task']),
			supervise: arena.function([arena.int, duration, duration, arena.function([arena.int], t, [], true, ['*'])], arena.result(t, supervisorError), ['T'], true, ['Task']),
		},
		Stream: {
			fromList: arena.function([arena.list(t)], streamT, ['T']), map: arena.function([streamT, arena.function([t], u, [], false, ['*'])], streamU, ['T', 'U']),
			filter: arena.function([streamT, arena.function([t], arena.bool, [], false, ['*'])], streamT, ['T']), collect: arena.function([streamT], arena.list(t), ['T'], true, ['Task']),
			take: arena.function([streamT, arena.int], streamT, ['T']),
		},
		File: {
			readText: arena.function([arena.string], arena.result(arena.string, jsError), [], true, ['File']), readBytes: arena.function([arena.string], arena.result(bytes, jsError), [], true, ['File']),
			writeText: arena.function([arena.string, arena.string], arena.result(arena.unit, jsError), [], true, ['File']), writeBytes: arena.function([arena.string, bytes], arena.result(arena.unit, jsError), [], true, ['File']),
			open: arena.function([arena.string, arena.string], arena.result(fileHandle, jsError), [], true, ['File']),
			read: arena.function([fileHandle], arena.result(arena.string, jsError), [], true, ['File']), readHandleBytes: arena.function([fileHandle], arena.result(bytes, jsError), [], true, ['File']),
			write: arena.function([fileHandle, arena.string], arena.result(arena.unit, jsError), [], true, ['File']), writeHandleBytes: arena.function([fileHandle, bytes], arena.result(arena.unit, jsError), [], true, ['File']),
			close: arena.function([fileHandle], arena.result(arena.unit, jsError), [], true, ['File']),
		},
		Path: {
			join: arena.function([arena.list(arena.string)], arena.string), resolve: arena.function([arena.list(arena.string)], arena.string),
			dirname: arena.function([arena.string], arena.string), basename: arena.function([arena.string], arena.string), extname: arena.function([arena.string], arena.string),
			normalize: arena.function([arena.string], arena.string), relative: arena.function([arena.string, arena.string], arena.string), isAbsolute: arena.function([arena.string], arena.bool),
		},
		Process: {
			args: arena.function([], arena.list(arena.string), [], false, ['Process']), cwd: arena.function([], arena.string, [], false, ['Process']),
			exitCode: arena.function([arena.int], arena.unit, [], false, ['Process']), environment: arena.function([arena.string], arena.option(arena.string), [], false, ['Process']),
			platform: arena.function([], arena.string, [], false, ['Process']), architecture: arena.function([], arena.string, [], false, ['Process']),
		},
		Http: { get: arena.function([arena.string], arena.result(httpResponse, jsError), [], true, ['Network']), request: arena.function([arena.string, arena.string, arena.map(arena.string, arena.string), httpBody], arena.result(httpResponse, jsError), [], true, ['Network']) },
		Fetch: { get: arena.function([arena.string], arena.result(httpResponse, jsError), [], true, ['Network']), request: arena.function([arena.string, arena.string, arena.map(arena.string, arena.string), httpBody], arena.result(httpResponse, jsError), [], true, ['Network']) },
		Timer: { sleep: arena.function([duration], arena.unit, [], true, ['Timer']), now: arena.function([], arena.int, [], false, ['Clock']) },
		Storage: {
			get: arena.function([arena.string], arena.option(arena.string), [], false, ['Storage']), set: arena.function([arena.string, arena.string], arena.unit, [], false, ['Storage']),
			remove: arena.function([arena.string], arena.unit, [], false, ['Storage']), clear: arena.function([], arena.unit, [], false, ['Storage']),
		},
		Dom: {
			getText: arena.function([arena.string], arena.result(arena.string, jsError), [], false, ['Dom']), setText: arena.function([arena.string, arena.string], arena.result(arena.unit, jsError), [], false, ['Dom']),
			setAttribute: arena.function([arena.string, arena.string, arena.string], arena.result(arena.unit, jsError), [], false, ['Dom']), addClass: arena.function([arena.string, arena.string], arena.result(arena.unit, jsError), [], false, ['Dom']),
		},
		Crypto: { randomUuid: arena.function([], arena.string, [], false, ['Random']) },
		Url: { encodeComponent: arena.function([arena.string], arena.string), decodeComponent: arena.function([arena.string], arena.result(arena.string, jsError)), isValid: arena.function([arena.string], arena.bool) },
		Json: {
			parse: arena.function([arena.string], arena.result(arena.unknown, jsonErrors)), decode: arena.function([arena.unknown], arena.result(t, jsonErrors), ['T']),
			encode: arena.function([t], arena.result(arena.string, jsonErrors), ['T']),
		},
	};
	return table[namespace]?.[member];
}
