from __future__ import annotations

from pathlib import Path
import re
import sys


def replace_once(path: str, old: str, new: str, label: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one replacement anchor, found {count}")
    file.write_text(text.replace(old, new, 1))


def replace_regex_once(path: str, pattern: str, replacement: str, label: str) -> None:
    file = Path(path)
    text = file.read_text()
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.DOTALL)
    if count != 1:
        raise SystemExit(f"{label}: expected one regex replacement anchor, found {count}")
    file.write_text(updated)


def apply_diagnostic_harness() -> None:
    runner_path = "packages/compiler/src/selfhost/full-language-inventory-runner.ts"
    replace_once(
        runner_path,
        "\treadonly onTimingEvidence?: (\n\t\tevidence: FullLanguageInventoryTimingEvidence,\n\t) => void | Promise<void>;\n}",
        "\treadonly onTimingEvidence?: (\n\t\tevidence: FullLanguageInventoryTimingEvidence,\n\t) => void | Promise<void>;\n\treadonly onInventoryEvidence?: (\n\t\tinventory: FullLanguageInventory,\n\t) => void | Promise<void>;\n}",
        "runner inventory evidence callback option",
    )
    replace_once(
        runner_path,
        "\t\tinventory = await timings.phase('validate-and-convert', () => {",
        "\t\tinventory = await timings.phase('validate-and-convert', async () => {",
        "runner asynchronous inventory conversion phase",
    )
    replace_once(
        runner_path,
        "\t\t\tconst value = inventoryFromFullLanguageResult(\n\t\t\t\tinput.sources.map(source => source.path),\n\t\t\t\tfirst,\n\t\t\t\tcapability,\n\t\t\t);\n\t\t\tif (value.boundaryBlockers.length > 0) {",
        "\t\t\tconst value = inventoryFromFullLanguageResult(\n\t\t\t\tinput.sources.map(source => source.path),\n\t\t\t\tfirst,\n\t\t\t\tcapability,\n\t\t\t);\n\t\t\tif (options.onInventoryEvidence !== undefined) {\n\t\t\t\tawait options.onInventoryEvidence(value);\n\t\t\t}\n\t\t\tif (value.boundaryBlockers.length > 0) {",
        "runner pre-boundary inventory evidence callback",
    )

    test_path = "packages/compiler/test/selfhost-full-language-inventory.test.ts"
    replace_once(
        test_path,
        "} from '../src/selfhost/full-language-inventory-runner.js';\nimport { serializeFullLanguageInventory } from '../src/selfhost/full-language-inventory.js';",
        "} from '../src/selfhost/full-language-inventory-runner.js';\nimport {\n\tserializeFullLanguageInventory,\n\ttype FullLanguageInventory,\n} from '../src/selfhost/full-language-inventory.js';",
        "inventory test FullLanguageInventory type import",
    )
    replace_once(
        test_path,
        "\t'.github/scripts/tmp-apply-full-language-readiness.py',\n",
        "\t'.github/scripts/tmp-apply-full-language-readiness.py',\n\t'.github/scripts/tmp-fix-full-language-readiness.py',\n",
        "inventory test source-fix script input",
    )
    replace_regex_once(
        test_path,
        r"async function applyFinalDiagnosticFixes\(probeRoot: string\): Promise<void> \{.*?\n\}\n\ntest\(",
        "async function applyFinalDiagnosticFixes(probeRoot: string): Promise<void> {\n"
        "\tawait executeFile(\n"
        "\t\t'python',\n"
        "\t\t['.github/scripts/tmp-fix-full-language-readiness.py'],\n"
        "\t\t{ cwd: probeRoot, maxBuffer: 16 * 1024 * 1024 },\n"
        "\t);\n"
        "}\n\n"
        "test(",
        "inventory test explicit source-fix execution",
    )
    replace_regex_once(
        test_path,
        r"\t\tconst inventory = await runFullLanguageInventory\(\{.*?\n\t\tconsole\.log\(`SELFHOST_FULL_LANGUAGE_FINAL_INVENTORY \$\{JSON\.stringify\(inventory\)\}`\);\n",
        "\t\tlet capturedInventory: FullLanguageInventory | null = null;\n"
        "\t\tawait assert.rejects(\n"
        "\t\t\t() => runFullLanguageInventory({\n"
        "\t\t\t\trepositoryRoot: probeRoot,\n"
        "\t\t\t\tcompileRuns: 1,\n"
        "\t\t\t\tonProgress: event => {\n"
        "\t\t\t\t\tconsole.error(formatFullLanguageInventoryProgress(event));\n"
        "\t\t\t\t},\n"
        "\t\t\t\tonTimingEvidence: async evidence => {\n"
        "\t\t\t\t\tawait mkdir(dirname(finalTimingEvidencePath), { recursive: true });\n"
        "\t\t\t\t\tawait writeFile(\n"
        "\t\t\t\t\t\tfinalTimingEvidencePath,\n"
        "\t\t\t\t\t\tserializeFullLanguageInventoryTimingEvidence(evidence),\n"
        "\t\t\t\t\t\t'utf8',\n"
        "\t\t\t\t\t);\n"
        "\t\t\t\t},\n"
        "\t\t\t\tonInventoryEvidence: async inventory => {\n"
        "\t\t\t\t\tcapturedInventory = inventory;\n"
        "\t\t\t\t\tawait mkdir(dirname(finalInventoryEvidencePath), { recursive: true });\n"
        "\t\t\t\t\tawait writeFile(\n"
        "\t\t\t\t\t\tfinalInventoryEvidencePath,\n"
        "\t\t\t\t\t\tserializeFullLanguageInventory(inventory),\n"
        "\t\t\t\t\t\t'utf8',\n"
        "\t\t\t\t\t);\n"
        "\t\t\t\t},\n"
        "\t\t\t}),\n"
        "\t\t\t/Full-language inventory boundary regression: capability-not-ready-for-ready-inventory, ready-capability-has-blockers/u,\n"
        "\t\t);\n"
        "\t\tassert.ok(capturedInventory !== null);\n"
        "\t\tconst inventory = capturedInventory as FullLanguageInventory;\n"
        "\t\tassert.equal(inventory.status, 'ready');\n"
        "\t\tassert.equal(inventory.capability.ready, false);\n"
        "\t\tassert.deepEqual(inventory.capability.blockers, ['full-language-lowering-not-implemented']);\n"
        "\t\tassert.equal(inventory.sourceCount, 31);\n"
        "\t\tassert.equal(inventory.parsedModules, 31);\n"
        "\t\tassert.equal(inventory.checkedModules, 31);\n"
        "\t\tassert.equal(inventory.emittedModules, 31);\n"
        "\t\tassert.equal(inventory.diagnosticCount, 0);\n"
        "\t\tassert.equal(inventory.diagnosticSourceCount, 0);\n"
        "\t\tassert.deepEqual(inventory.sourcesWithDiagnostics, []);\n"
        "\t\tassert.equal(inventory.sourcesWithoutDiagnostics.length, 31);\n"
        "\t\tassert.deepEqual(inventory.boundaryBlockers, [\n"
        "\t\t\t'capability-not-ready-for-ready-inventory',\n"
        "\t\t\t'ready-capability-has-blockers',\n"
        "\t\t]);\n"
        "\t\tassert.deepEqual(inventory.codeCounts, []);\n"
        "\t\tassert.deepEqual(inventory.entries, []);\n"
        "\t\tassert.deepEqual(inventory.firstDiagnostics, []);\n"
        "\t\tconsole.log(`SELFHOST_FULL_LANGUAGE_FINAL_INVENTORY ${JSON.stringify(inventory)}`);\n",
        "inventory test fail-closed readiness evidence assertions",
    )


def apply_source_fixes() -> None:
    core_path = "selfhost/mvp/src/frontend-parser-core.virune"
    core = Path(core_path).read_text()
    parsed_node_occurrences = len(re.findall(r"\bParsedNode\b", core))
    if parsed_node_occurrences != 59:
        raise SystemExit(
            f"frontend parser core: expected 59 ParsedNode occurrences, found {parsed_node_occurrences}"
        )
    if re.search(r"\bCoreParsedNode\b", core):
        raise SystemExit("frontend parser core: CoreParsedNode already exists")
    Path(core_path).write_text(re.sub(r"\bParsedNode\b", "CoreParsedNode", core))

    checker_path = "selfhost/mvp/src/checker.virune"
    replace_once(
        checker_path,
        "\tMvpHirStatement,\n\tMvpListElementType,",
        "\tMvpHirStatement,\n\tMvpImport,\n\tMvpListElementType,",
        "checker MvpImport import",
    )
    replace_once(
        checker_path,
        '\tif base == "ParsedNode" && fieldName == "id" {\n\t\treturn typeFromName("Int")\n\t}\n\tif base == "ParsedNodes" && fieldName == "ids" {',
        '\tif base == "CoreParsedNode" && fieldName == "id" {\n\t\treturn typeFromName("Int")\n\t}\n\tif base == "CoreParsedNode" && fieldName == "state" {\n\t\treturn typeFromName("CoreState")\n\t}\n\tif base == "ParsedNode" && fieldName == "id" {\n\t\treturn typeFromName("Int")\n\t}\n\tif base == "ParsedNode" && fieldName == "state" {\n\t\treturn typeFromName("ParserState")\n\t}\n\tif base == "ParsedNodes" && fieldName == "ids" {',
        "checker parsed node field mappings",
    )
    replace_once(
        checker_path,
        "fn checkMvpEncoded(\n\tencoded: String,",
        'fn emptyMvpModule() -> MvpModule {\n\tlet imports: List<MvpImport> = []\n\tlet functions: List<MvpFunction> = []\n\treturn MvpModule { imports: imports, functions: functions }\n}\n\nfn checkMvpEncoded(\n\tencoded: String,',
        "checker typed empty module helper",
    )
    replace_once(
        checker_path,
        "\t\tNone => MvpModule { imports: [], functions: [] }",
        "\t\tNone => emptyMvpModule()",
        "checker empty module fallback",
    )

    contract_path = "selfhost/mvp/src/project-compiler-contract.virune"
    replace_once(
        contract_path,
        "fn parseMvpProjectSources(\n\tsources: List<ProjectCompilerSourceV1>,",
        'fn emptyMvpModule() -> MvpModule {\n\tlet imports: List<MvpImport> = []\n\tlet functions: List<MvpFunction> = []\n\treturn MvpModule { imports: imports, functions: functions }\n}\n\nfn parseMvpProjectSources(\n\tsources: List<ProjectCompilerSourceV1>,',
        "project contract typed empty module helper",
    )
    replace_once(
        contract_path,
        "\t\t\tNone => MvpModule { imports: [], functions: [] }",
        "\t\t\tNone => emptyMvpModule()",
        "project contract empty module fallback",
    )

    replace_once(
        checker_path,
        '\tif base == "ParsedNodes" && fieldName == "ids" {',
        '\tif base == "ParsedDocumentation" && fieldName == "state" {\n'
        '\t\treturn typeFromName("CoreState")\n'
        '\t}\n'
        '\tif base == "ParsedDocumentation" && fieldName == "documentation" {\n'
        '\t\treturn typeFromName("List<String>")\n'
        '\t}\n'
        '\tif base == "ParsedMvpProjectSource" && fieldName == "path" {\n'
        '\t\treturn typeFromName("String")\n'
        '\t}\n'
        '\tif base == "ParsedMvpProjectSource" && fieldName == "parsedEncoded" {\n'
        '\t\treturn typeFromName("String")\n'
         '\t}\n'
        '\tif base == "ParsedMvpProjectSource" && fieldName == "moduleValue" {\n'
        '\t\treturn typeFromName("MvpModule")\n'
        '\t}\n'
        '\tif base == "ParsedNodes" && fieldName == "ids" {',
        "checker remaining record field mappings",
    )

    replace_once(
        contract_path,
        '''pub fn projectCompilerCapabilityJson() -> Result<String, List<JsonError>> {
\treturn Json.encode<ProjectCompilerCapabilityV1>(ProjectCompilerCapabilityV1 {
\t\tcontractVersion: "1",
\t\tready: true,
\t\trequestSchema: "virune.selfhost.project-compiler.request.v1",
\t\tresultSchema: "virune.selfhost.project-compiler.result.v2",
\t\tblockers: [],
\t})
}
''',
        '''pub fn projectCompilerCapabilityJson() -> Result<String, List<JsonError>> {
\treturn Json.encode<ProjectCompilerCapabilityV1>(ProjectCompilerCapabilityV1 {
\t\tcontractVersion: "1",
\t\tready: false,
\t\trequestSchema: "virune.selfhost.project-compiler.request.v1",
\t\tresultSchema: "virune.selfhost.project-compiler.result.v2",
\t\tblockers: ["full-language-lowering-not-implemented"],
\t})
}
''',
        "diagnostic fail-closed capability",
    )


def main() -> None:
    if sys.argv[1:] == ["--diagnostic-harness"]:
        apply_diagnostic_harness()
        return
    if sys.argv[1:]:
        raise SystemExit("usage: tmp-fix-full-language-readiness.py [--diagnostic-harness]")
    apply_source_fixes()


if __name__ == "__main__":
    main()
