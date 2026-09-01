import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { compileSource, externalOperationSequence } from '@virune/compiler/experimental';
import { TypeScriptInteropProvider } from '../src/index.js';
import { fixtureRoot } from './fixture.js';

const packageName = 'license-boundary-package';
const declarationBodySentinel = 'THIRD_PARTY_DECLARATION_BODY_SENTINEL';
const declarationDocSentinel = 'THIRD_PARTY_DECLARATION_DOC_SENTINEL';
const implementationSentinel = 'THIRD_PARTY_IMPLEMENTATION_SENTINEL';

async function compileWithLicense(license: string) {
	const root = await fixtureRoot();
	const packageRoot = join(root, 'node_modules', packageName);
	await mkdir(packageRoot, { recursive: true });
	await writeFile(join(packageRoot, 'package.json'), JSON.stringify({
		name: packageName,
		version: '1.2.3',
		type: 'module',
		license,
		exports: { '.': { types: './index.d.ts', import: './index.js', default: './index.js' } },
	}) + '\n', 'utf8');
	await writeFile(join(packageRoot, 'index.d.ts'), [
		`/** ${declarationDocSentinel} */`,
		`export interface ${declarationBodySentinel} { readonly value: string }`,
		'export declare function consume(callback: (value: string) => string): string;',
		'',
	].join('\n'), 'utf8');
	await writeFile(join(packageRoot, 'index.js'), [
		`const ${implementationSentinel} = "runtime-only";`,
		'export function consume(callback) {',
		`\tvoid ${implementationSentinel};`,
		'\treturn callback("value");',
		'}',
		'',
	].join('\n'), 'utf8');

	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	try {
		const result = compileSource({
			id: 1,
			path: join(root, 'src/main.virune'),
			text: [
				`import js { consume } from "${packageName}"`,
				'',
				'fn echo(value: String) -> String {',
				'\treturn value',
				'}',
				'',
				'fn main() -> String uses JavaScript {',
				'\treturn consume(echo)',
				'}',
				'',
			].join('\n'),
		}, { platform: 'node', jsInteropProvider: provider });
		return { root, result };
	} finally {
		provider.dispose();
	}
}

// @virune-rule {"id":"interop.third-party-distribution","runner":"unit","file":"packages/js-interop/test/license-boundary.test.ts","case":"stable interop evidence and generated JavaScript do not redistribute declaration or implementation bodies","kind":"positive","platform":"node"}
test('stable interop evidence and generated JavaScript do not redistribute declaration or implementation bodies', async () => {
	const { root, result } = await compileWithLicense('MIT');
	assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
	assert.ok(result.semantic);
	assert.equal(result.semantic.interop.callableProjections?.length, 1);

	const operations = externalOperationSequence(result.semantic);
	const stableEvidence = { usageIR: result.semantic.interop.usageIR, operations };
	assert.doesNotThrow(() => structuredClone(stableEvidence));
	const serialized = JSON.stringify(stableEvidence);
	for (const forbidden of [
		declarationBodySentinel,
		declarationDocSentinel,
		implementationSentinel,
		root.replaceAll('\\', '/'),
	]) {
		assert.equal(serialized.includes(forbidden), false, `stable evidence leaked ${forbidden}`);
	}

	const output = result.output?.code ?? '';
	assert.match(output, new RegExp(`from "${packageName}"`, 'u'));
	assert.match(output, /\$viruneProjectCallable\(echo,/u);
	assert.match(output, /encodeFfiValue\(/u);
	assert.equal(output.includes(declarationBodySentinel), false);
	assert.equal(output.includes(declarationDocSentinel), false);
	assert.equal(output.includes(implementationSentinel), false);
});

// @virune-rule {"id":"interop.third-party-distribution","runner":"unit","file":"packages/js-interop/test/license-boundary.test.ts","case":"dependency license metadata does not select an Interop mechanism or safety decision","kind":"positive","platform":"node"}
test('dependency license metadata does not select an Interop mechanism or safety decision', async () => {
	const permissive = await compileWithLicense('MIT');
	const copyleft = await compileWithLicense('GPL-3.0-only');
	for (const { result } of [permissive, copyleft]) {
		assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
		assert.ok(result.semantic);
	}
	assert.ok(permissive.result.semantic);
	assert.ok(copyleft.result.semantic);

	const semanticSummary = (result: typeof permissive.result) => externalOperationSequence(result.semantic!).map(operation => ({
		kind: operation.kind,
		decision: operation.decision,
	}));
	assert.deepEqual(semanticSummary(permissive.result), semanticSummary(copyleft.result));
	assert.equal(permissive.result.output?.code, copyleft.result.output?.code);
});
