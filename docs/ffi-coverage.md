# TypeScript binding coverage

`virune bind` intentionally prefers `Unknown` over an unsound declaration. Every fallback is emitted as a warning and the CLI prints the fallback count.

## Directly represented

- exported functions and overloads;
- exported function-valued variables;
- interfaces with readonly/optional data properties;
- generic records and aliases;
- arrays, readonly arrays, maps, sets, `Record<K, V>`, `Promise<T>`, callbacks, optional unions, primitive literal types, `Uint8Array`, and `Buffer`;
- rest parameters as `List<T>`.

## Explicit fallback or manual adapter

General unions, intersections, tuples, conditional/mapped/indexed-access types, callable objects, classes, namespaces, declaration merging, index signatures, branded types, async iterables, and lifecycle-sensitive APIs require `Unknown` validation or a handwritten adapter.

Safe generated bindings return `Result<T, JsError>`. `unsafe extern` remains a separate language feature and is never generated implicitly.

## Real-package corpus

The pinned corpus in `corpus/bindings/packages.json` contains 32 npm packages, including Zod, Fastify, React, Axios, date-fns, MySQL2, GraphQL, Vite, Hono, and Valibot. The current baseline generated bindings for all 32 packages: 1,791 functions and 1,160 records. It also reported 8,591 warnings and 7,120 `Unknown` mappings. These fallback counts are part of the compatibility report, not hidden as success.

Run `npm run test:binding-corpus` to regenerate every binding and compare its SHA-256 output with `corpus/bindings/report.json`. Package and TypeScript upgrades require an explicit reviewed baseline update.
