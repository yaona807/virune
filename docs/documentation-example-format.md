# Compile-tested documentation examples

[日本語](documentation-example-format_ja.md)

Virune code fences in maintained documentation must declare how they are validated. Existing major documents can use `docs/documentation-examples.json`; new examples should normally use an inline directive.

Supported modes are:

- `compile` — the generated temporary project must pass `virune check`;
- `run` — the project is executed and can assert stdout, stderr, and exit status;
- `compile-fail` — compilation must fail and the diagnostic must contain the declared match;
- `ignore` — execution is skipped, and a non-empty reason is mandatory.

Attributes use quoted strings when they contain spaces. `\n`, `\r`, and `\t` escapes are supported. Example IDs use lowercase letters, digits, and hyphens.

## Compile

```virune compile id="directive-compile"
fn add(left: Int, right: Int) -> Int => left + right
```

## Run with output verification

```virune run id="directive-run" stdout="Hello from documentation\n" stderr="" exit=0
pub fn main(args: List<String>) -> Unit uses Console {
	Console.print("Hello from documentation")
}
```

## Expected compilation failure

```virune compile-fail id="directive-compile-fail" match="docsCompileFailSentinel"
fn broken() -> Int => docsCompileFailSentinel
```

## Explicit ignore

```virune ignore id="directive-ignore" reason="Requires an external npm package that is intentionally absent from the documentation fixture."
import js { externalValue } from "documentation-only-package"
```

## Multiple modules

Fences with the same ID form one temporary project. The `file` attribute selects the project-relative source path.

```virune run id="directive-multi-module" file="src/math.virune" stdout="4\n" stderr="" exit=0
pub fn double(value: Int) -> Int => value * 2
```

```virune run id="directive-multi-module" file="src/main.virune"
import { double } from "./math.virune"

pub fn main(args: List<String>) -> Unit uses Console {
	Console.print("{double(2)}")
}
```

English and Japanese counterpart documents must contain the same example IDs. `sync="exact"` compares source and expectations exactly; `sync="structure"` ignores comments and string literal contents while preserving the program structure.
