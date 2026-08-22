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

function witness(runtimeEntry: string): ModuleResolutionWitness {
	return {
		moduleSpecifier: './library.js',
		runtimeEntry,
		runtimeFormat: 'esm',
		conditions: ['import', 'node'],
		platform: 'node',
		providerVersion: 'serialization-intrinsics-provider-1',
	};
}

function restoreProperty(target: object, key: PropertyKey, descriptor: PropertyDescriptor | undefined): void {
	if (descriptor === undefined) Reflect.deleteProperty(target, key);
	else Object.defineProperty(target, key, descriptor);
}

function parsedFieldExpressions(count: 1 | 2) {
	const lines = ['fn main() -> Unit {', '\tdiscard first.value'];
	if (count === 2) lines[lines.length] = '\tdiscard second.value';
	lines[lines.length] = '}';
	lines[lines.length] = '';
	const parsed = parseSource({ id: 1, path: '/virtual/serialization-intrinsics.virune', text: lines.join('\n') });
	assert.ok(parsed.ast);
	assert.deepEqual(parsed.diagnostics.filter(item => item.severity === 'error'), []);
	const declaration = parsed.ast.declarations[0];
	assert.equal(declaration?.kind, 'FunctionDeclaration');
	if (declaration?.kind !== 'FunctionDeclaration' || declaration.body.kind !== 'BlockStatement') throw new Error('expected function block');
	const result = [];
	for (let index = 0; index < declaration.body.statements.length; index++) {
		const statement = declaration.body.statements[index];
		if (statement?.kind !== 'DiscardStatement' || statement.expression.kind !== 'FieldExpression') throw new Error('expected field expression');
		result[result.length] = statement.expression;
	}
	assert.equal(result.length, count);
	return { module: parsed.ast, expressions: result };
}

function stableString(nodeId: number, usageSpan: ForeignUsageIR['span']): ForeignUsageIR {
	return {
		kind: 'property',
		nodeId,
		span: usageSpan,
		foreignType: {
			display: 'string',
			category: 'primitive',
			primitive: 'string',
			origin: { moduleSpecifier: './library.js', exportName: 'value' },
		},
	};
}

function currentString(nodeId: number, usageSpan: ForeignUsage['span'], id: string): ForeignUsage {
	return {
		kind: 'property',
		nodeId,
		span: usageSpan,
		foreignType: {
			ref: { providerId: 'serialization-intrinsics-provider', generation: 1, id },
			display: 'string',
			category: 'primitive',
			primitive: 'string',
			origin: { moduleSpecifier: './library.js', exportName: 'value' },
		},
	};
}

test('inherited Object toJSON cannot collapse inconsistent runtime witnesses into resolved Direct evidence', () => {
	const previous = Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON');
	Object.defineProperty(Object.prototype, 'toJSON', {
		configurable: true,
		value(this: Record<string, unknown>) {
			if (
				Object.prototype.hasOwnProperty.call(this, 'moduleSpecifier')
				&& Object.prototype.hasOwnProperty.call(this, 'conditions')
				&& Object.prototype.hasOwnProperty.call(this, 'platform')
			) return 'masked-runtime-witness';
			return this;
		},
	});
	try {
		assert.equal(
			JSON.stringify({ moduleSpecifier: './library.js', runtimeEntry: 'dist/library.js', conditions: [], platform: 'node' }),
			JSON.stringify({ moduleSpecifier: './library.js', runtimeEntry: 'dist/other.js', conditions: [], platform: 'node' }),
			'test must prove inherited toJSON can mask distinct runtime witnesses for the old equality design',
		);
		const operation = externalModuleLoadOperation({
			nodeId: 1,
			span,
			moduleSpecifier: './library.js',
			witnesses: [witness('dist/library.js'), witness('dist/other.js')],
		});
		assert.equal(operation.decision.status, 'unresolved');
		assert.equal(operation.runtimeWitness, undefined);
		assert.equal(isResolvedDirectInteropDecision(operation.decision), false);
	} finally {
		restoreProperty(Object.prototype, 'toJSON', previous);
	}
});

test('inherited Object toJSON cannot hide a mismatch between current and stable foreign type facts', () => {
	const { module, expressions } = parsedFieldExpressions(1);
	const expression = expressions[0]!;
	const stable = stableString(expression.id, expression.span);
	const current: ForeignUsage = {
		...currentString(expression.id, expression.span, 'number-result'),
		foreignType: {
			ref: { providerId: 'serialization-intrinsics-provider', generation: 1, id: 'number-result' },
			display: 'number',
			category: 'primitive',
			primitive: 'number',
			origin: { moduleSpecifier: './library.js', exportName: 'value' },
		},
	};
	const interop: InteropSemanticModel = {
		usages: [current],
		usageIR: [stable],
		moduleWitnesses: [],
		requiresJavaScriptInitialization: false,
	};
	const previous = Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON');
	Object.defineProperty(Object.prototype, 'toJSON', {
		configurable: true,
		value(this: Record<string, unknown>) {
			if (Object.prototype.hasOwnProperty.call(this, 'category')) return 'masked-foreign-shape';
			return this;
		},
	});
	try {
		assert.equal(
			JSON.stringify({ category: 'primitive', primitive: 'string' }),
			JSON.stringify({ category: 'primitive', primitive: 'number' }),
			'test must prove inherited toJSON can mask distinct foreign facts for the old equality design',
		);
		assert.throws(
			() => externalOperationSequence({ module, interop, diagnostics: [] }),
			/Stale or cross-session External usage evidence/u,
		);
	} finally {
		restoreProperty(Object.prototype, 'toJSON', previous);
	}
});

test('inherited Array toJSON is not consulted when encoding current usage order anchors', () => {
	const { module, expressions } = parsedFieldExpressions(2);
	const stable = expressions.map(expression => stableString(expression.id, expression.span));
	const current = expressions.map((expression, index) => currentString(expression.id, expression.span, `string-${index}`));
	const interop: InteropSemanticModel = {
		usages: current,
		usageIR: stable,
		moduleWitnesses: [],
		requiresJavaScriptInitialization: false,
	};
	const previous = Object.getOwnPropertyDescriptor(Array.prototype, 'toJSON');
	Object.defineProperty(Array.prototype, 'toJSON', {
		configurable: true,
		value() {
			throw new Error('usage anchor encoding must not read inherited Array.toJSON');
		},
	});
	try {
		const operations = externalOperationSequence({ module, interop, diagnostics: [] });
		assert.equal(operations.length, 2);
		assert.equal(operations[0]?.kind, 'read-property');
		assert.equal(operations[1]?.kind, 'read-property');
	} finally {
		restoreProperty(Array.prototype, 'toJSON', previous);
	}
});
