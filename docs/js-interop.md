# JavaScript and TypeScript interoperability

[日本語](js-interop_ja.md)

## Boundary model

Virune uses three levels:

1. generated direct bindings for TypeScript declarations that can be validated completely;
2. compiled TypeScript adapters for deliberate shape conversion;
3. isolated `unsafe extern` declarations for manually audited boundaries.

Normal Virune code imports safe facades and does not need to know the raw JavaScript representation.

## Import forms

```virune
import js { nanoid } from "nanoid"
import js axios from "axios"
import js * as fs from "node:fs/promises"
import js "./polyfill.js"
import js type { AxiosRequestConfig } from "axios"
```

The form remains explicit because ESM named/default/namespace imports, side-effect modules, and CommonJS exports have different runtime semantics.

## Safe binding rules

A generated Safe FFI signature is allowed only when every input and output has a complete runtime descriptor.

Supported categories include validated primitives, Option/Result, Bytes, supported primitive-key collections, and finite non-recursive native aggregates.

The generator falls back to `Unknown` or requires an adapter for:

- callback/function values;
- recursive records;
- unresolved or unconstrained generic aggregates;
- TypeScript `Record<K, V>` plain objects;
- object-keyed JavaScript Map or object-valued identity-sensitive Set;
- conditional, mapped, intersection, overload, callable-object, namespace-merging, and other unsupported shapes;
- any aggregate whose descriptor would contain an unchecked unknown subshape.

Conservative fallback is a safety feature, not a successful type conversion.

## Optional values

Virune uses `T?`, but Interop ABI v2 retains JavaScript boundary details:

- optional property absence can become `None` through `missingAsNone`;
- output fields can be omitted through `omitWhenNone`;
- `null`, `undefined`, and nullish acceptance remain descriptor metadata;
- a trailing optional parameter with `None` is omitted from the JavaScript call rather than always passed as `undefined`.

## Foreign handles

Foreign values do not appear in public native Virune signatures. Expose an audited operation set and hide the handle behind a `newtype` or private module representation. Foreign identity is not converted into structural native equality.

## TypeScript adapters

Adapters are appropriate when an npm API uses callbacks, overloads, classes, iterables, recursive structures, or JavaScript identity semantics. An adapter should convert the external shape into primitives, validated native aggregates, `Unknown`, or an explicit foreign handle.

## JavaScript exports

`@jsExport` functions receive generated wrappers that validate input, convert Option/Result/Enum values, preserve nominal IDs, and defensively copy exposed native aggregates. Export signatures are subject to the same complete-descriptor requirement as Safe FFI.
