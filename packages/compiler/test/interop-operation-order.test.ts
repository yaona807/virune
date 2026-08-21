import assert from 'node:assert/strict';
import test from 'node:test';
import { externalOperationSequence } from '../src/interop/operation.js';
import type { ForeignUsage, ForeignUsageIR, InteropSemanticModel } from '../src/interop/types.js';
import { parseSource } from '../src/project/project.js';

const stableString = {
	display: 'string',
	category: 'primitive' as const,
	primitive: 'string' as const,
	origin: { moduleSpecifier: './library.js', exportName: 'value' },
};

test('stable usage order must match the current checker semantic order', () => {
	const parsed = parseSource({
		id: 1,
		path: '/virtual/main.virune',
		text: 'fn main() -> Unit {\n\tdiscard first.value\n\tdiscard second.value\n}\n',
	});
	assert.ok(parsed.ast);
	const declaration = parsed.ast.declarations[0];
	assert.equal(declaration?.kind, 'FunctionDeclaration');
	if (declaration?.kind !== 'FunctionDeclaration' || declaration.body.kind !== 'BlockStatement') throw new Error('expected function block');
	const firstStatement = declaration.body.statements[0];
	const secondStatement = declaration.body.statements[1];
	if (firstStatement?.kind !== 'DiscardStatement' || firstStatement.expression.kind !== 'FieldExpression') throw new Error('expected first field expression');
	if (secondStatement?.kind !== 'DiscardStatement' || secondStatement.expression.kind !== 'FieldExpression') throw new Error('expected second field expression');

	const stableFirst: ForeignUsageIR = {
		kind: 'property',
		nodeId: firstStatement.expression.id,
		span: firstStatement.expression.span,
		foreignType: stableString,
	};
	const stableSecond: ForeignUsageIR = {
		kind: 'property',
		nodeId: secondStatement.expression.id,
		span: secondStatement.expression.span,
		foreignType: stableString,
	};
	const currentFirst: ForeignUsage = {
		...stableFirst,
		foreignType: { ...stableString, ref: { providerId: 'test', generation: 1, id: 'first' } },
	};
	const currentSecond: ForeignUsage = {
		...stableSecond,
		foreignType: { ...stableString, ref: { providerId: 'test', generation: 1, id: 'second' } },
	};
	const currentInterop: InteropSemanticModel = {
		usages: [currentFirst, currentSecond],
		usageIR: [stableFirst, stableSecond],
		moduleWitnesses: [],
		requiresJavaScriptInitialization: false,
	};
	assert.deepEqual(
		externalOperationSequence({ module: parsed.ast, interop: currentInterop, diagnostics: [] }).map(operation => operation.kind),
		['read-property', 'read-property'],
	);

	assert.throws(
		() => externalOperationSequence({
			module: parsed.ast!,
			interop: { ...currentInterop, usageIR: [stableSecond, stableFirst] },
			diagnostics: [],
		}),
		/current checker usage order disagrees/u,
	);
});
