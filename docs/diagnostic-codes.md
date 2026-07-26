# Diagnostic codes and JSON schema

[English](diagnostic-codes.md) | [日本語](diagnostic-codes_ja.md)

Virune diagnostics have a stable short code and a qualified code:

- short code: `L2043`
- qualified code: `virune/L2043`
- LSP source: `virune`

Existing `Lxxxx` codes remain unchanged for compatibility. External tools should compare `source` plus `code`, or use `qualifiedCode`, instead of matching message text.

## Code ranges

| Range | Category | Meaning |
| --- | --- | --- |
| `L0000`–`L0999` | `syntax` | Lexing, parsing, syntax, and source documentation |
| `L1000`–`L1999` | `binding` | Declarations, names, symbols, and visibility |
| `L2000`–`L2999` | `type-system` | Types, effects, calls, and value compatibility |
| `L3000`–`L3999` | `control-flow` | Control flow, exhaustiveness, ownership, and reachability |
| `L4000`–`L4999` | `module` | Project configuration, module graphs, and JavaScript interop |
| `L5000`–`L5999` | `entry-point` | CLI and executable entry-point validation |
| `L9000`–`L9999` | `internal` | Unknown or internal compiler and tool failures |

New codes are allocated monotonically inside the relevant range. A code is never reused for a different semantic condition.

## Severity model

The stable severity values are:

- `error`: compilation or the requested operation cannot complete
- `warning`: the operation can complete, but the program has a likely defect or portability risk
- `information`: non-blocking explanatory information
- `hint`: non-blocking guidance or a suggested improvement

The Compiler API, CLI JSON output, and LSP mapping use the same values. LSP maps them to Error, Warning, Information, and Hint respectively.

## JSON diagnostics

Use:

```bash
virune check . --diagnostic-format=json
```

The output is a document with `schemaVersion: 1`. The published JSON Schema is available from the compiler package as:

```text
@virune/compiler/diagnostics.schema.json
```

Example:

```json
{
  "schemaVersion": 1,
  "diagnostics": [
    {
      "source": "virune",
      "code": "L2043",
      "qualifiedCode": "virune/L2043",
      "category": "type-system",
      "severity": "error",
      "message": "Expected String but received Int",
      "file": "src/main.virune",
      "range": {
        "start": { "line": 2, "column": 9 },
        "end": { "line": 2, "column": 10 }
      },
      "related": [],
      "help": null,
      "fixIds": [],
      "cause": null
    }
  ]
}
```

Lines and columns are one-based. `related` entries contain their own file and range. `fixIds` are stable identifiers suitable for matching a compiler fix to an editor code action. Internal diagnostics may include a structured `cause` with `kind`, `message`, and optional `name` and `stack`.

## Current code catalog

The exact current code list is derived from compiler and CLI sources. From a repository checkout, run:

```bash
node scripts/diagnostic-catalog.mjs
node scripts/diagnostic-catalog.mjs --json
```

CI executes the same catalog scanner and rejects malformed, uncategorized, or non-literal diagnostic codes in production sources.

Common codes include:

| Code | Meaning |
| --- | --- |
| `L0001` | Invalid token or character sequence |
| `L0002` | Source does not match the grammar |
| `L2043` | A value is incompatible with the required type |
| `L3004` | A match expression is not exhaustive |
| `L4002` | The module dependency graph contains a cycle |
| `L5010` | The executable entry module or output is unavailable |
| `L9001` | AST construction failed after parsing |

Use `virune explain <code>` for a concise explanation where a code-specific explanation is available.

## Compatibility policy

The following changes are non-breaking within schema version 1:

- message wording, punctuation, and additional context
- adding `related`, `help`, `fixIds`, or `cause` content while preserving their field types
- adding a new diagnostic code for a new semantic condition

The following changes require an explicit compatibility review and normally a major language or schema version:

- removing or reusing a published code
- changing the semantic meaning of a code
- changing a code's severity for the same condition
- changing range coordinates, indexing rules, or required JSON fields
- changing the type or meaning of a structured field

Tools must not use message text as a stable identifier. They should tolerate unknown future codes and additional schema versions by checking `schemaVersion` before parsing.
