import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
	formatFullLanguageInventoryProgress,
	runFullLanguageInventory,
	serializeFullLanguageInventoryTimingEvidence,
} from '../src/selfhost/full-language-inventory-runner.js';
import { serializeFullLanguageInventory } from '../src/selfhost/full-language-inventory.js';

const executeFile = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const finalInventoryEvidencePath = join(
	repositoryRoot,
	'.cache',
	'ci-timings',
	'selfhost-full-language-final-inventory.json',
);
const finalTimingEvidencePath = join(
	repositoryRoot,
	'.cache',
	'ci-timings',
	'selfhost-full-language-final-timings.json',
);
const canonicalInventoryTestSource = "import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport { mkdir, writeFile } from 'node:fs/promises';\nimport { dirname, join, resolve } from 'node:path';\nimport { fileURLToPath } from 'node:url';\nimport { runFullLanguageInventory } from '../src/selfhost/full-language-inventory-runner.js';\nimport { serializeFullLanguageInventory } from '../src/selfhost/full-language-inventory.js';\n\nconst repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');\nconst inventoryEvidencePath = join(\n\trepositoryRoot,\n\t'.cache',\n\t'ci-timings',\n\t'selfhost-full-language-inventory.json',\n);\n\ntest('full-language inventory is deterministic for the canonical self-host source set', { timeout: 1_500_000 }, async () => {\n\tconst inventory = await runFullLanguageInventory({ repositoryRoot });\n\tassert.equal(inventory.sourceCount, inventory.parsedModules);\n\tassert.equal(inventory.sourceCount, inventory.checkedModules);\n\tassert.equal(\n\t\tinventory.sourcesWithDiagnostics.length + inventory.sourcesWithoutDiagnostics.length,\n\t\tinventory.sourceCount,\n\t);\n\tassert.equal(\n\t\tinventory.codeCounts.reduce((total, entry) => total + entry.count, 0),\n\t\tinventory.diagnosticCount,\n\t);\n\tassert.equal(inventory.firstDiagnostics.length, inventory.diagnosticSourceCount);\n\tassert.deepEqual(\n\t\tinventory.firstDiagnostics.map(item => item.sourcePath),\n\t\tinventory.sourcesWithDiagnostics,\n\t);\n\tassert.ok(inventory.firstDiagnostics.every(item => item.span.end.offset >= item.span.start.offset));\n\tassert.deepEqual(inventory.boundaryBlockers, []);\n\tconst diagnosticCountFor = (code: string): number =>\n\t\tinventory.codeCounts.find(entry => entry.code === code)?.count ?? 0;\n\tassert.equal(diagnosticCountFor('L2014'), 0);\n\tawait mkdir(dirname(inventoryEvidencePath), { recursive: true });\n\tawait writeFile(inventoryEvidencePath, serializeFullLanguageInventory(inventory), 'utf8');\n\tconsole.log(`SELFHOST_FULL_LANGUAGE_INVENTORY ${JSON.stringify(inventory)}`);\n});\n";

const patchInputs = [
	'.github/scripts/tmp-apply-full-language-readiness.py',
	'docs/self-hosting-project-compiler-integration.md',
	'docs/self-hosting-project-compiler-integration_ja.md',
	'docs/self-hosting-stage1-stage2-bootstrap.md',
	'docs/self-hosting-stage1-stage2-bootstrap_ja.md',
	'packages/compiler/test/selfhost-bootstrap-stage-runner.test.ts',
	'packages/compiler/test/selfhost-project-compiler-contract.test.ts',
	'packages/compiler/test/selfhost-qualified-builtins-variants.test.ts',
	'selfhost/mvp',
] as const;

function replaceOnce(text: string, oldValue: string, newValue: string, label: string): string {
	const count = text.split(oldValue).length - 1;
	assert.equal(count, 1, `${label} replacement anchor must occur exactly once`);
	return text.replace(oldValue, newValue);
}

async function applyFinalDiagnosticFixes(probeRoot: string): Promise<void> {
	const corePath = join(probeRoot, 'selfhost', 'mvp', 'src', 'frontend-parser-core.virune');
	const checkerPath = join(probeRoot, 'selfhost', 'mvp', 'src', 'checker.virune');
	const contractPath = join(probeRoot, 'selfhost', 'mvp', 'src', 'project-compiler-contract.virune');

	const coreSource = await readFile(corePath, 'utf8');
	const parsedNodeOccurrences = coreSource.match(/\bParsedNode\b/gu)?.length ?? 0;
	assert.equal(parsedNodeOccurrences, 59, 'core ParsedNode rename surface changed unexpectedly');
	assert.doesNotMatch(coreSource, /\bCoreParsedNode\b/u);
	await writeFile(corePath, coreSource.replaceAll(/\bParsedNode\b/gu, 'CoreParsedNode'), 'utf8');

	let checkerSource = await readFile(checkerPath, 'utf8');
	checkerSource = replaceOnce(
		checkerSource,
		'\tMvpHirStatement,\n\tMvpListElementType,',
		'\tMvpHirStatement,\n\tMvpImport,\n\tMvpListElementType,',
		'checker MvpImport import',
	);
	checkerSource = replaceOnce(
		checkerSource,
		'\tif base == "ParsedNode" && fieldName == "id" {\n\t\treturn typeFromName("Int")\n\t}\n\tif base == "ParsedNodes" && fieldName == "ids" {',
		'\tif base == "CoreParsedNode" && fieldName == "id" {\n\t\treturn typeFromName("Int")\n\t}\n\tif base == "CoreParsedNode" && fieldName == "state" {\n\t\treturn typeFromName("CoreState")\n\t}\n\tif base == "ParsedNode" && fieldName == "id" {\n\t\treturn typeFromName("Int")\n\t}\n\tif base == "ParsedNode" && fieldName == "state" {\n\t\treturn typeFromName("ParserState")\n\t}\n\tif base == "ParsedNodes" && fieldName == "ids" {',
		'checker parsed node field mappings',
	);
	checkerSource = replaceOnce(
		checkerSource,
		'fn checkMvpEncoded(\n\tencoded: String,',
		'fn emptyMvpModule() -> MvpModule {\n\tlet imports: List<MvpImport> = []\n\tlet functions: List<MvpFunction> = []\n\treturn MvpModule { imports: imports, functions: functions }\n}\n\nfn checkMvpEncoded(\n\tencoded: String,',
		'checker typed empty module helper',
	);
	checkerSource = replaceOnce(
		checkerSource,
		'\t\tNone => MvpModule { imports: [], functions: [] }',
		'\t\tNone => emptyMvpModule()',
		'checker empty module fallback',
	);
	await writeFile(checkerPath, checkerSource, 'utf8');

	let contractSource = await readFile(contractPath, 'utf8');
	contractSource = replaceOnce(
		contractSource,
		'fn parseMvpProjectSources(\n\tsources: List<ProjectCompilerSourceV1>,',
		'fn emptyMvpModule() -> MvpModule {\n\tlet imports: List<MvpImport> = []\n\tlet functions: List<MvpFunction> = []\n\treturn MvpModule { imports: imports, functions: functions }\n}\n\nfn parseMvpProjectSources(\n\tsources: List<ProjectCompilerSourceV1>,',
		'project contract typed empty module helper',
	);
	contractSource = replaceOnce(
		contractSource,
		'\t\t\tNone => MvpModule { imports: [], functions: [] }',
		'\t\t\tNone => emptyMvpModule()',
		'project contract empty module fallback',
	);
	await writeFile(contractPath, contractSource, 'utf8');
}

test('final full-language readiness patch reaches 31 modules with zero diagnostics', { timeout: 3_300_000 }, async () => {
	const temporaryParent = await mkdtemp(join(tmpdir(), 'virune-full-language-probe-'));
	const probeRoot = join(temporaryParent, 'repository');
	try {
		for (const relativePath of patchInputs) {
			const source = join(repositoryRoot, relativePath);
			const destination = join(probeRoot, relativePath);
			await mkdir(dirname(destination), { recursive: true });
			await cp(source, destination, { recursive: true });
		}
		const runtimePackageRoot = join(probeRoot, 'node_modules', '@virune', 'runtime');
		await mkdir(dirname(runtimePackageRoot), { recursive: true });
		await cp(join(repositoryRoot, 'packages', 'runtime'), runtimePackageRoot, { recursive: true });
		const canonicalInventoryTestPath = join(
			probeRoot,
			'packages',
			'compiler',
			'test',
			'selfhost-full-language-inventory.test.ts',
		);
		await mkdir(dirname(canonicalInventoryTestPath), { recursive: true });
		await writeFile(canonicalInventoryTestPath, canonicalInventoryTestSource, 'utf8');
		await executeFile('git', ['init'], { cwd: probeRoot });
		await executeFile('git', ['add', '.'], { cwd: probeRoot });
		await executeFile(
			'python',
			['.github/scripts/tmp-apply-full-language-readiness.py'],
			{ cwd: probeRoot, maxBuffer: 16 * 1024 * 1024 },
		);
		await applyFinalDiagnosticFixes(probeRoot);
		const inventory = await runFullLanguageInventory({
			repositoryRoot: probeRoot,
			compileRuns: 1,
			onProgress: event => {
				console.error(formatFullLanguageInventoryProgress(event));
			},
			onTimingEvidence: async evidence => {
				await mkdir(dirname(finalTimingEvidencePath), { recursive: true });
				await writeFile(
					finalTimingEvidencePath,
					serializeFullLanguageInventoryTimingEvidence(evidence),
					'utf8',
				);
			},
		});
		await mkdir(dirname(finalInventoryEvidencePath), { recursive: true });
		await writeFile(
			finalInventoryEvidencePath,
			serializeFullLanguageInventory(inventory),
			'utf8',
		);
		assert.equal(inventory.status, 'ready');
		assert.equal(inventory.capability.ready, true);
		assert.deepEqual(inventory.capability.blockers, []);
		assert.equal(inventory.sourceCount, 31);
		assert.equal(inventory.parsedModules, 31);
		assert.equal(inventory.checkedModules, 31);
		assert.equal(inventory.emittedModules, 31);
		assert.equal(inventory.diagnosticCount, 0);
		assert.equal(inventory.diagnosticSourceCount, 0);
		assert.deepEqual(inventory.sourcesWithDiagnostics, []);
		assert.equal(inventory.sourcesWithoutDiagnostics.length, 31);
		assert.deepEqual(inventory.boundaryBlockers, []);
		assert.deepEqual(inventory.codeCounts, []);
		assert.deepEqual(inventory.entries, []);
		assert.deepEqual(inventory.firstDiagnostics, []);
		console.log(`SELFHOST_FULL_LANGUAGE_FINAL_INVENTORY ${JSON.stringify(inventory)}`);
	} finally {
		await rm(temporaryParent, { recursive: true, force: true });
	}
});
