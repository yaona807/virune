# JavaScript Interoperability Model

[日本語版](js-interop_ja.md)

Low-level `extern js` rules are defined in [JavaScript FFI](ffi.md).

## `[interop.direct]` Direct facade

`import js` exposes a conservative subset of a declared JavaScript API. Dependency source is executed unchanged. The direct facade supports default, named, namespace, side-effect, and named type-only imports; property access; function and method calls; forwarding foreign handles; and `await` on declared Promise-like results.

The provider resolves calls only from the callee and actual argument types. A Virune expected return type MUST NOT participate in JavaScript overload or generic selection. Return-only generic parameters MAY resolve from a TypeScript default or base constraint. If the provider cannot determine one supported call from the callee and actual argument types alone, the call MUST use an adapter.

A native Virune callable MAY satisfy a supported JavaScript callback position only through the generated callable boundary defined below. Its raw runtime function MUST NOT be passed directly to JavaScript.

Named imports from a CommonJS runtime are rejected. Runtime module resolution used by a browser or bundler remains the bundler's responsibility.

Source checking MAY retain a build-stage `runtime-resolution` obligation as pending; a diagnostic-clean check is not execution authorization. Before `virune run` or `virune test` starts emitted JavaScript, every runtime module load in the executed module closure MUST have provider-independent runtime-resolution evidence discharged for that exact build. Pending, unresolved, missing, invalid, or contradictory evidence MUST fail closed without starting Node.

A TypeScript `any` import is rejected by the direct facade. TypeScript `unknown` remains an unknown foreign value and can cross to Virune `Unknown` without asserting a narrower type.

### Contextual External operations

A bare contextual aggregate `{ field: value }` MAY become a plain JavaScript data object only when the pinned provider proves the complete object usage against an expected External structural type. The expected type MAY come from a named type-only JavaScript import without creating a runtime import. Nested contextual aggregates and supported native callable entries are checked in the same TypeScript usage. Missing, extra, incompatible, stale, partial, malformed, `any`, or `unknown` evidence MUST fail closed. Native Virune records, lists, tuples, and other composite values do not implicitly become JavaScript objects.

Contextual object entries evaluate from left to right exactly once. Property spellings are emitted as computed data properties, so names such as `__proto__` remain ordinary own data properties rather than changing the object prototype. A native callable entry uses the generated callable boundary below; its raw Virune function representation MUST NOT leak into the JavaScript object.

`value[index]` is available only when TypeScript proves the indexed access for the actual receiver and index value. The receiver and index evaluate once in JavaScript order and the result remains a foreign value until an allowed bridge is applied. Unsupported index kinds, unresolved access, and `any` or `unknown` evidence MUST fail closed.

External property and index assignment are available only when TypeScript accepts the corresponding assignment to the declared target. Readonly or otherwise inaccessible writes MUST fail closed. Emission preserves ordinary JavaScript reference semantics and evaluation order: receiver before value for property assignment, and receiver before index before value for index assignment. Setters, proxy traps, and synchronous exceptions therefore retain their JavaScript behavior.

Ordinary call syntax MAY be emitted as construction only when call resolution does not succeed and the provider proves a construct usage from the callee and actual arguments. A value that is both callable and constructable is ambiguous and MUST NOT be guessed as a constructor. Private or inaccessible constructors, unresolved generic results, malformed or stale evidence, and unsupported constructor selections MUST fail closed. Supported overload and generic constructor selection is delegated to TypeScript using actual arguments only. Emission uses JavaScript construction semantics and preserves argument order and constructor exceptions.

Successful contextual object, index, write, and construct decisions MUST be represented by provider-independent External Operation evidence. Provider handles and generation data are checker-local proof inputs and MUST NOT become stable operation output. The compiler MUST validate that evidence is current, complete, structurally canonical, and attached to the matching usage before enabling emission; it MUST NOT recreate general TypeScript assignability rules.

### Generated callable boundaries

A generated callable boundary is available only when the pinned provider selects one whole JavaScript call usage and proves a supported contextual callback shape for the callable argument. Missing, stale, malformed, ambiguous, unresolved, `any`, `unknown`, construct-only, unresolved generic, explicit-`this`, optional/rest-parameter, or required callable-object-property evidence MUST fail closed and require an adapter. The Virune compiler MUST NOT recreate general TypeScript assignability rules.

The primitive callable subset accepts concrete named, non-generic Virune functions that are not `@jsExport`, use only supported primitive parameters and results or `Unit`, and have a concrete effect set. It MAY also accept a synchronous zero-parameter inline lambda in a JavaScript call-argument position when its result is a supported primitive or `Unit` and its effect set is concrete. Values captured by such a lambda remain lexical closure state: they MUST NOT be inspected, encoded, or treated as callable-boundary parameters or results, and only the generated JavaScript shim crosses the boundary. The pinned provider MUST still accept the final whole JavaScript usage for the zero-parameter callback. `uses *`, native composite boundary values, and erased `Unknown` values MUST NOT cross this primitive boundary. A TypeScript `number` callback parameter does not prove a Virune `Int` input boundary; a Virune `Int` result MAY be projected to TypeScript `number`.

A contextual External callable subset MAY additionally accept an unannotated inline lambda, either synchronous or `async`, in the final JavaScript call-argument position when it consumes at least one parameter and the pinned provider provisionally proves that every consumed contextual parameter is a concrete non-primitive External object type in the same current provider generation and workspace. Provisional contextual evidence is only an input for checking the lambda body. After the body is checked, the compiler MUST submit the resulting concrete native callable type back to the provider and require the final whole JavaScript usage to succeed before projection evidence is committed. `any`, `unknown`, unresolved or ambiguous contextual types, stale or provider-mismatched evidence, native composite values, raw native callables or capabilities, and unsupported callback shapes MUST NOT be accepted as External callback data or results. The final callback result MAY be the exact External value accepted by the final TypeScript usage or `Never`; other native results MUST fail closed.

The compiler owns a canonical, provider-independent descriptor containing its version, compiler-owned parameter/result categories, async mode, concrete effects, and external-root invocation mode. The primitive descriptor uses the existing Safe FFI validation and encoding rules. The contextual External descriptor records only compiler-owned `External` markers (and `Never` for a non-returning result); provider handles, generations, workspace identity, and TypeScript-private type identity MUST remain checker-local proof inputs. Its generated JavaScript shim MUST forward already-External arguments and results by identity without decoding or encoding them as native aggregates, invoke the native lambda with a fresh root task context, and preserve panic/control-flow sanitization, synchronous throw, asynchronous rejection, and JavaScript argument evaluation order.

TypeScript `void` does not grant Virune discard semantics. A synchronous `() => void` target accepts only a synchronous Virune callback returning `Unit`; an async `Promise<void>` target accepts only an async Virune callback returning `Unit`.

Callable identity is the pair of native function identity and canonical boundary descriptor. Repeated projection of the same function under the same descriptor MUST return the same JavaScript function object, while a different descriptor MUST NOT alias it. The versioned cache is a non-enumerable compiler-internal property on the native function; this mechanism MUST NOT add a public project helper, origin export, Runtime ABI entry point, or FFI ABI entry point.

Stable projection evidence MUST identify the generated `callable-shim` mechanism, the canonical descriptor, Virune-owned safety claims and obligations, the callback argument index, and its insertion index in the External Operation sequence. Checker-internal usage indexes MUST NOT become part of the stable contract.

## `[interop.foreign-values]` Foreign values

Foreign values remain JavaScript-side values and preserve JavaScript identity, prototype, method receiver, Promise behavior, and module binding semantics. They may be forwarded to another foreign call. Virune arithmetic, comparison, pattern matching, collection semantics, and native methods require a prior bridge to a native Virune type.

Foreign values MUST NOT appear in public Virune signatures. External handles are exposed through a Virune `newtype` type.

## `[interop.bridges]` Bridges

Implicit bridges are limited to one-to-one runtime representations:

- JavaScript `boolean` to `Bool`
- JavaScript `string` to `String`
- JavaScript `bigint` to `BigInt`
- JavaScript `number` to `Float`
- TypeScript `void` to `Unit` by discarding the returned value
- TypeScript `unknown` to Virune `Unknown`

JavaScript `number` to `Int`, arrays to `List`, objects to records, Map/Set conversion, byte conversion, nullable conversion, and native composite values passed to JavaScript require explicit codecs.

A failed implicit primitive check raises `ForeignContractError`. It is not converted to an ordinary JavaScript exception result. Recoverable external data validation uses an explicit decoder.

## `[interop.abi-v1]` Interop ABI v1

An adapter is a `*.interop.ts` source file type-checked with the pinned TypeScript provider and emitted as ESM before Virune execution.

An adapter export MUST be a single non-generic call signature. Callback parameters, overloads, arrays, tuples, anonymous structural objects, adapter-local object types, intersections, `any`, and nested Promise-like values are not ABI v1 values. Structural data is exported as `unknown` and decoded in Virune. Named external classes and objects may be exported as foreign handles.

Adapter output consists of `.interop.mjs`, a source map, and `.virune-abi.json`. ABI metadata is deterministic and includes the schema version, ABI version, pinned TypeScript provider version, source hash, ABI hash, normalized exports, and source path.

Adapters MUST NOT import generated Virune output.
