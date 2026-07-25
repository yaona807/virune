# Compile-test対象ドキュメント例

[English](documentation-example-format.md)

管理対象ドキュメントのVirune code fenceには、検証方法を指定します。既存の主要ドキュメントは`docs/documentation-examples.json`を使用でき、新規例では通常inline directiveを使用します。

対応modeは次のとおりです。

- `compile` — 生成した一時projectが`virune check`を通過すること
- `run` — projectを実行し、stdout、stderr、終了statusを検証できること
- `compile-fail` — compileが失敗し、diagnosticに指定patternが含まれること
- `ignore` — 実行を省略し、空でない理由を必須とすること

空白を含むattributeはquoted stringで指定します。`\n`、`\r`、`\t` escapeを利用できます。Example IDには小文字英字、数字、hyphenを使用します。

## Compile

```virune compile id="directive-compile"
fn add(left: Int, right: Int) -> Int => left + right
```

## 出力を検証するRun

```virune run id="directive-run" stdout="Hello from documentation\n" stderr="" exit=0
pub fn main(args: List<String>) -> Unit uses Console {
	Console.print("Hello from documentation")
}
```

## 期待するCompile失敗

```virune compile-fail id="directive-compile-fail" match="docsCompileFailSentinel"
fn broken() -> Int => docsCompileFailSentinel
```

## 明示的なIgnore

```virune ignore id="directive-ignore" reason="Requires an external npm package that is intentionally absent from the documentation fixture."
import js { externalValue } from "documentation-only-package"
```

## 複数Module

同じIDを持つfenceは一つの一時projectを構成します。`file` attributeでprojectからのsource pathを指定します。

```virune run id="directive-multi-module" file="src/math.virune" stdout="4\n" stderr="" exit=0
pub fn double(value: Int) -> Int => value * 2
```

```virune run id="directive-multi-module" file="src/main.virune"
import { double } from "./math.virune"

pub fn main(args: List<String>) -> Unit uses Console {
	Console.print("{double(2)}")
}
```

英語版と日本語版のcounterpartは同じexample IDを持つ必要があります。`sync="exact"`はsourceと期待値を完全一致で比較し、`sync="structure"`はprogram構造を保持しながらcommentとstring literalの内容を無視します。
