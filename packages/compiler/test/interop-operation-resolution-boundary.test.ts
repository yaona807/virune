import assert from 'node:assert/strict';
import test from 'node:test';
import { isResolvedDirectInteropDecision } from '../src/interop/decision.js';
import { externalModuleLoadOperation, externalOperationSequence } from '../src/interop/operation.js';
import type { ForeignUsage, ForeignUsageIR, InteropSemanticModel, ModuleResolutionWitness } from '../src/interop/types.js';
import { parseSource } from '../src/project/project.js';

const span = {
	fileId: 1,
	start: { offset: 0, line: 1, column: 1 },
	end: { offset: 1, line: 1, column: 2 },
};

function witness(overrides: Partial<ModuleResolutionWitness> = {}): ModuleResolutionWitness {
	return {
		moduleSpecifier: './library.js',
		runtimeEntry: 'dist/library.js',
		runtimeFormat: 'esm',
		conditions: ['import', 'node'],
		platform: 'node',
		providerVersion: 'test-provider-1',
		packageJsonHash: 'a'.repeat(64),
		...overrides,
	};
}

test('only known runtime resolution states become resolved or build-pending Direct evidence', () => {
	for (const runtimeFormat of ['esm', 'commonjs', 'builtin'] as const) {
		const runtimeEntry = runtimeFormat === 'builtin' ? 'node:fs' : 'dist/library.js';
		const operation = externalModuleLoadOperation({
			nodeId: 1,
			span,
			moduleSpecifier: './library.js',
			witnesses: [witness({ runtimeFormat, runtimeEntry })],
		});
		assert.equal(operation.decision.status, 'resolved');
		assert.deepEqual(operation.decision.obligations, [
			{ kind: 'runtime-resolution', stage: 'check', status: 'discharged' },
		]);
		assert.equal(isResolvedDirectInteropDecision(operation.decision), true);
	}

	const { runtimeEntry: _runtimeEntry, ...bundlerWitness } = witness({ platform: 'browser', runtimeFormat: 'bundler' });
	const bundler = externalModuleLoadOperation({
		nodeId: 2,
		span,
		moduleSpecifier: './library.js',
		witnesses: [bundlerWitness],
	});
	assert.equal(bundler.decision.status, 'obligation-pending');
	assert.deepEqual(bundler.decision.obligations, [
		{ kind: 'runtime-resolution', stage: 'build', status: 'pending' },
	]);
	assert.equal(isResolvedDirectInteropDecision(bundler.decision), false);
});

test('unknown or missing runtime format remains unresolved rather than being guessed as a build obligation', () => {
	const unknown = externalModuleLoadOperation({
		nodeId: 1,
		span,
		moduleSpecifier: './library.js',
		witnesses: [witness({ runtimeFormat: 'unknown' })],
	});
	assert.equal(unknown.decision.status, 'unresolved');
	assert.deepEqual(unknown.decision.obligations, []);
	assert.equal(isResolvedDirectInteropDecision(unknown.decision), false);

	const { runtimeFormat: _runtimeFormat, ...withoutFormat } = witness();
	const missing = externalModuleLoadOperation({
		nodeId: 1,
		span,
		moduleSpecifier: './library.js',
		witnesses: [withoutFormat],
	});
	assert.equal(missing.decision.status, 'unresolved');
	assert.deepEqual(missing.decision.obligations, []);
	assert.equal(isResolvedDirectInteropDecision(missing.decision), false);
});

test('same node id and span cannot rebind a usage to a different AST operation kind', () => {
	const parsed = parseSource({
		id: 1,
		path: '/virtual/main.virune',
		text: 'fn main() -> Unit {\n\tdiscard value.field\n}\n',
	});
	assert.ok(parsed.ast);
	assert.deepEqual(parsed.diagnostics.filter(item => item.severity === 'error'), []);

	const declaration = parsed.ast.declarations[0];
	assert.equal(declaration?.kind, 'FunctionDeclaration');
	if (declaration?.kind !== 'FunctionDeclaration') throw new Error('expected FunctionDeclaration');
	assert.equal(declaration.body.kind, 'BlockStatement');
	if (declaration.body.kind !== 'BlockStatement') throw new Error('expected BlockStatement');
	const statement = declaration.body.statements[0];
	assert.equal(statement?.kind, 'DiscardStatement');
	if (statement?.kind !== 'DiscardStatement') throw new Error('expected DiscardStatement');
	assert.equal(statement.expression.kind, 'FieldExpression');
	if (statement.expression.kind !== 'FieldExpression') throw new Error('expected FieldExpression');

	const staleCall: ForeignUsageIR = {
		kind: 'call',
		nodeId: statement.expression.id,
		span: statement.expression.span,
		foreignType: {
			display: 'string',
			category: 'primitive',
			primitive: 'string',
			origin: { moduleSpecifier: './library.js', exportName: 'field' },
		},
		receiverMode: 'none',
		mayReject: false,
	};
	const currentCall: ForeignUsage = {
		kind: 'call',
		nodeId: statement.expression.id,
		span: statement.expression.span,
		foreignType: {
			ref: { providerId: 'test', generation: 1, id: 'field-call-result' },
			display: 'string',
			category: 'primitive',
			primitive: 'string',
			origin: { moduleSpecifier: './library.js', exportName: 'field' },
		},
		receiverMode: 'none',
		mayReject: false,
	};
	const interop: InteropSemanticModel = {
		usages: [currentCall],
		usageIR: [staleCall],
		moduleWitnesses: [],
		requiresJavaScriptInitialization: false,
	};
	assert.throws(
		() => externalOperationSequence({ module: parsed.ast!, interop, diagnostics: [] }),
		/Stale or cross-session External usage evidence/u,
	);
});
