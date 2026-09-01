import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import {
	assertExternalImportLegalMetadata,
	compileSource,
	externalImportProvenance,
	externalOperationSequence,
	type ExternalImportProvenanceEvidence,
} from '@virune/compiler/experimental';
import { TypeScriptInteropProvider } from '../src/index.js';
import { fixtureRoot } from './fixture.js';

async function installPackage(root: string, packageName: string): Promise<void> {
	const packageRoot = join(root, 'node_modules', packageName);
	await mkdir(packageRoot, { recursive: true });
	await writeFile(join(packageRoot, 'package.json'), JSON.stringify({
		name: packageName,
		version: '1.2.3',
		type: 'module',
		exports: { '.': { types: './index.d.ts', import: './index.js', default: './index.js' } },
	}) + '\n', 'utf8');
	await writeFile(join(packageRoot, 'index.d.ts'), 'export interface Shape { readonly value: string }\nexport declare function greet(name: string): string;\n', 'utf8');
	await writeFile(join(packageRoot, 'index.js'), 'export function greet(name) { return name; }\n', 'utf8');
}

async function compilePackage(packageName: string, platform: 'node' | 'browser' = 'node', typeOnly = false) {
	const root = await fixtureRoot();
	await installPackage(root, packageName);
	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	const source = typeOnly
		? `import js type { Shape } from ${JSON.stringify(packageName)}\n\nfn main() -> Unit {\n\treturn Unit\n}\n`
		: `import js { greet } from ${JSON.stringify(packageName)}\n\nfn main() -> Unit uses JavaScript {\n\tdiscard greet("hello")\n\treturn Unit\n}\n`;
	const result = compileSource({ id: 1, path: join(root, 'src/main.virune'), text: source }, { platform, jsInteropProvider: provider });
	provider.dispose();
	return result;
}

function available(evidence: ExternalImportProvenanceEvidence) {
	assert.equal(evidence.status, 'available');
	if (evidence.status !== 'available') throw new Error('Expected available provenance');
	return evidence.imports;
}

test('resolved package imports expose deterministic auditable provenance', async () => {
	const first = await compilePackage('provenance-package');
	const second = await compilePackage('provenance-package');
	assert.deepEqual(first.diagnostics.filter(item => item.severity === 'error'), []);
	assert.deepEqual(second.diagnostics.filter(item => item.severity === 'error'), []);
	assert.ok(first.semantic);
	assert.ok(second.semantic);
	const firstEvidence = externalImportProvenance(first.semantic);
	const secondEvidence = externalImportProvenance(second.semantic);
	assert.deepEqual(firstEvidence, secondEvidence);
	const imports = available(firstEvidence);
	assert.equal(imports.length, 1);
	assert.equal(imports[0]?.moduleSpecifier, 'provenance-package');
	assert.equal(imports[0]?.kind, 'runtime');
	assert.equal(imports[0]?.resolution, 'resolved');
	assert.equal(imports[0]?.packageName, 'provenance-package');
	assert.equal(imports[0]?.packageVersion, '1.2.3');
	assert.match(imports[0]?.packageJsonHash ?? '', /^[0-9a-f]{64}$/u);
	assert.equal(imports[0]?.declarationPackageName, 'provenance-package');
	assert.equal(imports[0]?.declarationPackageVersion, '1.2.3');
	assert.equal(imports[0]?.declarationEntry, 'index.d.ts');
	assert.match(imports[0]?.declarationGraphHash ?? '', /^[0-9a-f]{64}$/u);
	assert.equal(imports[0]?.runtimeEntry, 'index.js');
	assertExternalImportLegalMetadata(firstEvidence);
});

test('package rename changes provenance without selecting a different Direct mechanism', async () => {
	const outcomes = [];
	for (const packageName of ['provenance-alpha', 'provenance-beta']) {
		const result = await compilePackage(packageName);
		assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
		assert.ok(result.semantic);
		const provenance = available(externalImportProvenance(result.semantic))[0]!;
		const call = externalOperationSequence(result.semantic).find(operation => operation.kind === 'call');
		assert.equal(call?.kind, 'call');
		if (call?.kind !== 'call') throw new Error('Expected call operation');
		outcomes.push({ packageName: provenance.packageName, mechanism: call.decision.mechanism, receiverMode: call.receiverMode });
	}
	assert.notEqual(outcomes[0]?.packageName, outcomes[1]?.packageName);
	assert.equal(outcomes[0]?.mechanism, outcomes[1]?.mechanism);
	assert.equal(outcomes[0]?.receiverMode, outcomes[1]?.receiverMode);
});

test('type-only provenance is declaration evidence and browser runtime provenance remains pending', async () => {
	const typeOnly = await compilePackage('provenance-types', 'node', true);
	assert.deepEqual(typeOnly.diagnostics.filter(item => item.severity === 'error'), []);
	assert.ok(typeOnly.semantic);
	const typeOnlyImport = available(externalImportProvenance(typeOnly.semantic))[0]!;
	assert.equal(typeOnlyImport.kind, 'type-only');
	assert.equal(typeOnlyImport.resolution, 'resolved');
	assert.equal(externalOperationSequence(typeOnly.semantic).some(operation => operation.kind === 'module-load'), false);
	assertExternalImportLegalMetadata(externalImportProvenance(typeOnly.semantic));

	const browser = await compilePackage('provenance-browser', 'browser');
	assert.deepEqual(browser.diagnostics.filter(item => item.severity === 'error'), []);
	assert.ok(browser.semantic);
	const browserEvidence = externalImportProvenance(browser.semantic);
	const browserImport = available(browserEvidence)[0]!;
	assert.equal(browserImport.runtimeFormat, 'bundler');
	assert.equal(browserImport.resolution, 'pending');
	assert.throws(() => assertExternalImportLegalMetadata(browserEvidence), /is pending; legal metadata is not publishable/u);
});

test('failed and incomplete provenance never becomes legal-ready evidence', async () => {
	const root = await fixtureRoot();
	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	const unresolved = compileSource({
		id: 1,
		path: join(root, 'src/main.virune'),
		text: 'import js { missing } from "missing-provenance-package"\n\nfn main() -> Unit {\n\treturn Unit\n}\n',
	}, { platform: 'node', jsInteropProvider: provider });
	provider.dispose();
	assert.ok(unresolved.diagnostics.some(item => item.severity === 'error'));
	assert.ok(unresolved.semantic);
	assert.equal(externalImportProvenance(unresolved.semantic).status, 'unavailable');
	assert.throws(() => assertExternalImportLegalMetadata({ status: 'unavailable' }), /evidence is unavailable/u);
	assert.throws(() => assertExternalImportLegalMetadata({
		status: 'available',
		imports: [{
			moduleSpecifier: 'partial-package',
			kind: 'runtime',
			resolution: 'resolved',
			platform: 'node',
			providerVersion: 'typescript-test',
			packageName: 'partial-package',
			packageVersion: '1.0.0',
			declarationEntry: 'index.d.ts',
			declarationGraphHash: '0'.repeat(64),
			runtimeEntry: 'index.js',
			runtimeFormat: 'esm',
		}],
	}), /incomplete runtime package provenance/u);
});
