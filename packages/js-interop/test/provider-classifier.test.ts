import assert from 'node:assert/strict';
import test from 'node:test';
import type { ForeignTypeSnapshot, JsImportResolution, ModuleResolutionWitness } from '@virune/compiler/experimental';
import { classifyImportResolution, runtimeEvidence } from '../src/provider-classifier.js';

function snapshot(overrides: Partial<ForeignTypeSnapshot> = {}): ForeignTypeSnapshot {
	return {
		ref: { providerId: 'typescript', generation: 1, id: 't1' },
		display: 'string',
		category: 'primitive',
		primitive: 'string',
		origin: { moduleSpecifier: 'fixture', declarationPath: '/repo/node_modules/fixture/index.d.ts', exportName: 'greet' },
		...overrides,
	};
}

function witness(overrides: Partial<ModuleResolutionWitness> = {}): ModuleResolutionWitness {
	return {
		moduleSpecifier: 'fixture',
		declarationEntry: '/repo/node_modules/fixture/index.d.ts',
		runtimeEntry: '/repo/node_modules/fixture/index.js',
		runtimeFormat: 'esm',
		conditions: ['import', 'node'],
		platform: 'node',
		providerVersion: 'typescript-6.0.3',
		...overrides,
	};
}

function resolution(overrides: Partial<JsImportResolution> = {}): JsImportResolution {
	return {
		type: snapshot(),
		runtime: { kind: 'named', importedName: 'greet' },
		witness: witness(),
		...overrides,
	};
}

test('verified ESM primitive binding can become auto-safe', () => {
	const result = classifyImportResolution(resolution(), { readRuntimeSource: () => 'export const greet = "hello";' });
	assert.ok(result !== undefined);
	assert.equal(result.runtimeBinding.status, 'verified-static');
	assert.equal(result.facts.shape.runtimeBinding, 'verified');
	assert.equal(result.facts.evidenceConflict, undefined);
	assert.equal(result.decision.gate, 'AUTO_SAFE');
});

test('statically absent runtime binding conflicts with the declaration contract', () => {
	const result = classifyImportResolution(resolution(), { readRuntimeSource: () => 'export const other = "hello";' });
	assert.ok(result !== undefined);
	assert.equal(result.runtimeBinding.status, 'absent');
	assert.equal(result.facts.evidenceConflict, true);
	assert.equal(result.decision.gate, 'UNRESOLVED');
	assert.ok(result.decision.reasons.includes('EVIDENCE_CONFLICT'));
});

test('reexports stay runtime-unverified instead of becoming false-safe', () => {
	const result = classifyImportResolution(resolution(), { readRuntimeSource: () => 'export { greet } from "./other.js";' });
	assert.ok(result !== undefined);
	assert.equal(result.runtimeBinding.status, 'unknown');
	assert.equal(result.facts.shape.runtimeBinding, 'unverified');
	assert.equal(result.facts.evidenceConflict, undefined);
	assert.equal(result.decision.gate, 'SEMANTICS_REQUIRED');
});

test('missing runtime source stays unverified', () => {
	const result = classifyImportResolution(resolution(), { readRuntimeSource: () => undefined });
	assert.ok(result !== undefined);
	assert.equal(result.runtimeBinding.reason, 'SOURCE_UNAVAILABLE');
	assert.equal(result.decision.gate, 'SEMANTICS_REQUIRED');
});

test('simple CommonJS named binding is verified without executing it', () => {
	const result = classifyImportResolution(resolution({ witness: witness({ runtimeFormat: 'commonjs', runtimeEntry: '/repo/node_modules/fixture/index.cjs' }) }), {
		readRuntimeSource: () => 'exports.greet = "hello";',
	});
	assert.ok(result !== undefined);
	assert.equal(result.runtimeBinding.status, 'verified-static');
	assert.equal(result.decision.gate, 'AUTO_SAFE');
});

test('unsupported bundler resolution does not read or claim runtime proof', () => {
	let reads = 0;
	const result = classifyImportResolution(resolution({ witness: witness({ runtimeFormat: 'bundler' }) }), {
		readRuntimeSource: () => { reads++; return 'export const greet = "hello";'; },
	});
	assert.ok(result !== undefined);
	assert.equal(reads, 0);
	assert.equal(result.runtimeBinding.status, 'unknown');
	assert.equal(result.decision.gate, 'SEMANTICS_REQUIRED');
});

test('runtime binding evidence is preserved as an independent fact', () => {
	const result = classifyImportResolution(resolution(), { readRuntimeSource: () => 'export const greet = "hello";' });
	assert.ok(result !== undefined);
	assert.ok(result.facts.evidence?.some(item => item.source === 'static-behavior' && item.fact === 'runtime-binding' && item.detail === 'verified-static:ESM_DECLARATION_EXPORT'));
});

test('type-less side-effect resolution is outside value classification', () => {
	assert.equal(classifyImportResolution({ runtime: { kind: 'side-effect' }, witness: witness() }), undefined);
});

test('runtimeEvidence avoids file reads for namespace imports with a resolved entry', () => {
	let reads = 0;
	const evidence = runtimeEvidence({ type: { ref: { providerId: 'typescript', generation: 1, id: 'o1' }, display: 'typeof import("fixture")', category: 'object', origin: { moduleSpecifier: 'fixture', declarationPath: '/repo/node_modules/fixture/index.d.ts' } }, runtime: { kind: 'namespace' }, witness: witness() }, () => { reads++; return ''; });
	assert.equal(reads, 0);
	assert.equal(evidence.status, 'verified-static');
});
