# Self-host module symbol visibility

[English](self-hosting-module-visibility.md)

Module visibility sliceは、canonical lexical scope arenaに続くboundedなsymbol scope／visibility段階を完成させます。Fileの読み込みや実際のproject graph解決を行わず、moduleとmodule symbolを決定的な連番arenaとして表現し、accessを検証します。

## Visibility rule

- Symbolは`value`、`type`、`capability` namespaceへ分離したまま扱います。
- Private symbolは定義module内からアクセスできます。
- Moduleを越えるアクセスではsymbolがpublicである必要があります。
- Public APIのsignatureはprivate nominal typeを参照できません。
- Builtin signature typeはmodule IDを`null`として表現し、arena参照を作りません。

Private symbolへのcross-module accessとprivate nominal typeの公開API露出は`L4010`です。未知のsymbolまたはsignature typeは`L2040`、duplicate module／symbolは`L1001`、不正なID、namespace、kind、nameは`L9001`になります。

JSON resultはcanonical module／symbol ID、解決済みsignature type ID、access判定、決定的diagnosticを返します。Focused Host testでは、namespace分離、same-module private access、cross-module public access、公開API漏洩、duplicate処理、不正入力、serialization決定性、参照整合性を検証します。

```bash
npm run build
node --test --test-timeout=120000 packages/compiler/dist/test/selfhost-module-visibility.test.js
```

このsliceはmodule graphの読み込み、import path／re-export chain解決、Self-host CheckerのProduction Compiler接続を行いません。Grammar、stable Compiler API、Runtime ABI、Interop ABI、public standard libraryも変更しません。
