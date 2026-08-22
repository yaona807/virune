import assert from 'node:assert/strict';
import test from 'node:test';
import { externalOperationSequence } from '../src/interop/operation.js';
import type { ForeignUsage, ForeignUsageIR, InteropSemanticModel } from '../src/interop/types.js';
import { parseSource } from '../src/project/project.js';

function restoreProperty(target: object, key: PropertyKey, descriptor: PropertyDescriptor | undefined): void {
	if (descriptor === undefined) Reflect.deleteProperty(target, key);
	else Object.defineProperty(target, key, descriptor);
}

test('inherited foreignCall cannot authorize call evidence without an own checker marker', () => {
	const parsed = parseSource({
		id: 1,
		path: '/virtual/inherited-foreign-call.virune',
		text: 'fn main() -> Unit {\n\tdiscard local()\n}\n',
	});
	assert.ok(parsed.ast);
	assert.deepEqual(parsed.diagnostics.filter(item => item.severity === 'error'), []);
	const declaration = parsed.ast.declarations[0];
	assert.equal(declaration?.kind, 'FunctionDeclaration');
	if (declaration?.kind !== 'FunctionDeclaration' || declaration.body.kind !== 'BlockStatement') throw new Error('expected function block');
	const statement = declaration.body.statements[0];
	assert.equal(statement?.kind, 'DiscardStatement');
	if (statement?.kind !== 'DiscardStatement' || statement.expression.kind !== 'CallExpression') throw new Error('expected call expression');
	const call = statement.expression;
	assert.equal(Object.getOwnPropertyDescriptor(call, 'foreignCall'), undefined);

	const stableCall: ForeignUsageIR = {
		kind: 'call',
		nodeId: call.id,
		span: call.span,
		foreignType: {
			display: 'unknown',
			category: 'unknown',
		},
		receiverMode: 'none',
		mayReject: false,
	};
	const currentCall: ForeignUsage = {
		...stableCall,
		foreignType: {
			ref: { providerId: 'inherited-marker-provider', generation: 1, id: 'result' },
			display: 'unknown',
			category: 'unknown',
		},
	};
	const interop: InteropSemanticModel = {
		usages: [currentCall],
		usageIR: [stableCall],
		moduleWitnesses: [],
		requiresJavaScriptInitialization: false,
	};

	const previous = Object.getOwnPropertyDescriptor(Object.prototype, 'foreignCall');
	Object.defineProperty(Object.prototype, 'foreignCall', {
		configurable: true,
		value: true,
	});
	try {
		assert.throws(
			() => externalOperationSequence({ module: parsed.ast!, interop, diagnostics: [] }),
			/Stale or cross-session External usage evidence/u,
		);
	} finally {
		restoreProperty(Object.prototype, 'foreignCall', previous);
	}
});
