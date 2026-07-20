# Types

## `[type.static]` Static typing
Virune is statically typed. Every expression has a compile-time type, and the compiler rejects implicit numeric, string, nullable, foreign, and aggregate conversions.

## `[type.nominal-identity]` Nominal identity
Records, enums, and `newtype` declarations are identified by package, module, and declaration identity—not spelling. Equally named declarations in different modules are distinct. Import aliases and public re-exports preserve the original identity.

## `[type.alias]` Type aliases and newtypes
`type` is a transparent alias and creates no new identity. A `newtype` creates a nominal identity while erasing to its underlying JavaScript representation. Construction is available only in the declaring module; public checked constructors are ordinary functions.

## `[type.tuple]` Tuples
Tuple types and values preserve element order and element types. Tuple patterns must match the tuple arity.

## `[type.nullability]` Absence
Normal Virune values are never `null` or `undefined`. `T?` is the canonical spelling of a one-level `Option<T>`. `Option<T>` remains available where nesting must be explicit. `Some` and `None` are always explicit values.

## `[type.result]` Recoverable failure
Recoverable failure uses `Result<T, E>`. The postfix `?` propagates `Err` or `None` only from a function whose return type can receive the propagated value.

## `[type.inference]` Inference
Local value and generic call types are inferred by unification. Public API boundaries remain explicit. Virune performs no implicit numeric, string, option, result, foreign, or aggregate conversion.

## `[type.generics]` Generics
Generic declarations are invariant. Type arguments are inferred from call arguments and explicit expected callback types. Virune 1.0 has no protocol constraints, higher-kinded types, user-defined variance, overloads, or implicit implementation search.

## `[type.composition]` Behaviour composition
Reusable behaviour is represented with ordinary functions and records containing function fields. Implementations are passed explicitly; the language has no `protocol`, `impl`, or `where` declarations. This keeps dependency injection, codecs, comparators, repositories, and test doubles within the same value model as normal code.

## `[type.capabilities]` Effects
Function types may include a fixed built-in effect set declared with `uses`. Calls require the enclosing function to declare every concrete required effect. Users cannot declare new capability names or effect handlers.

## `[type.open-effect-nonescaping]` Open callback effects
`uses *` is limited to non-escaping callback parameters. Such a callback may be called directly or forwarded to another `uses *` callback parameter. It cannot be stored in a record, enum, tuple, list, map, alias, newtype, closure, return value, top-level value, or local variable. This preserves effect tracking without exposing effect-row types.

## `[type.mutation]` Mutation
Bindings and native aggregate values are immutable by default. `let mut` permits local reassignment only. Record fields, enum payloads, native collections, and newtype values are not mutated in place.

## `[type.must-use]` Must-use values
`Future`, `Result`, resources, streams, and declarations annotated `@mustUse` cannot be silently ignored. A program must bind, return, propagate, await, match, or explicitly discard the value with `discard expression`.
