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

function interop(usages: readonly ForeignUsage[], usageIR: readonly ForeignUsageIR[]): InteropSemanticModel {
	return {
		usages,
		usageIR,
		moduleWitnesses: [],
		requiresJavaScriptInitialization: false,
	};
}

function emptyInterop(usageIR: readonly ForeignUsageIR[]): InteropSemanticModel {
	return interop([], usageIR);
}

test('a CallExpression without the checker foreign-call marker cannot accept stale Direct call evidence', () => {
	const parsed = parseSource({
		id: 1,
		path: '/virtual/main.virune',
		text: 'fn main() -> Unit {\n\tdiscard local()\n}\n',
	});
	assert.ok(parsed.ast);
	const declaration = parsed.ast.declarations[0];
	assert.equal(declaration?.kind, 'FunctionDeclaration');
	if (declaration?.kind !== 'FunctionDeclaration' || declaration.body.kind !== 'BlockStatement') throw new Error('expected function block');
	const statement = declaration.body.statements[0];
	assert.equal(statement?.kind, 'DiscardStatement');
	if (statement?.kind !== 'DiscardStatement' || statement.expression.kind !== 'CallExpression') throw new Error('expected call expression');
	assert.equal(statement.expression.foreignCall, undefined);

	const staleCall: ForeignUsageIR = {
		kind: 'call',
		nodeId: statement.expression.id,
		span: statement.expression.span,
		foreignType: stableString,
		receiverMode: 'none',
		mayReject: false,
	};
	assert.throws(
		() => externalOperationSequence({ module: parsed.ast!, interop: emptyInterop([staleCall]), diagnostics: [] }),
		/Stale or cross-session External usage evidence/u,
	);
});

test('a FieldExpression without current checker usage cannot accept stale Direct property evidence', () => {
	const parsed = parseSource({
		id: 1,
		path: '/virtual/main.virune',
		text: 'fn main() -> Unit {\n\tdiscard value.field\n}\n',
	});
	assert.ok(parsed.ast);
	const declaration = parsed.ast.declarations[0];
	assert.equal(declaration?.kind, 'FunctionDeclaration');
	if (declaration?.kind !== 'FunctionDeclaration' || declaration.body.kind !== 'BlockStatement') throw new Error('expected function block');
	const statement = declaration.body.statements[0];
	assert.equal(statement?.kind, 'DiscardStatement');
	if (statement?.kind !== 'DiscardStatement' || statement.expression.kind !== 'FieldExpression') throw new Error('expected field expression');

	const staleProperty: ForeignUsageIR = {
		kind: 'property',
		nodeId: statement.expression.id,
		span: statement.expression.span,
		foreignType: stableString,
	};
	assert.throws(
		() => externalOperationSequence({ module: parsed.ast!, interop: emptyInterop([staleProperty]), diagnostics: [] }),
		/Stale or cross-session External usage evidence/u,
	);
});

test('an AwaitExpression without current checker usage cannot accept stale Direct await evidence', () => {
	const parsed = parseSource({
		id: 1,
		path: '/virtual/main.virune',
		text: 'async fn main() -> Unit {\n\tdiscard await value\n}\n',
	});
	assert.ok(parsed.ast);
	const declaration = parsed.ast.declarations[0];
	assert.equal(declaration?.kind, 'FunctionDeclaration');
	if (declaration?.kind !== 'FunctionDeclaration' || declaration.body.kind !== 'BlockStatement') throw new Error('expected function block');
	const statement = declaration.body.statements[0];
	assert.equal(statement?.kind, 'DiscardStatement');
	if (statement?.kind !== 'DiscardStatement' || statement.expression.kind !== 'AwaitExpression') throw new Error('expected await expression');

	const staleAwait: ForeignUsageIR = {
		kind: 'await',
		nodeId: statement.expression.id,
		span: statement.expression.span,
		foreignType: stableString,
		mayReject: true,
	};
	assert.throws(
		() => externalOperationSequence({ module: parsed.ast!, interop: emptyInterop([staleAwait]), diagnostics: [] }),
		/Stale or cross-session External usage evidence/u,
	);
});

test('stable property facts must match the current checker-session foreign result', () => {
	const parsed = parseSource({
		id: 1,
		path: '/virtual/main.virune',
		text: 'fn main() -> Unit {\n\tdiscard value.field\n}\n',
	});
	assert.ok(parsed.ast);
	const declaration = parsed.ast.declarations[0];
	assert.equal(declaration?.kind, 'FunctionDeclaration');
	if (declaration?.kind !== 'FunctionDeclaration' || declaration.body.kind !== 'BlockStatement') throw new Error('expected function block');
	const statement = declaration.body.statements[0];
	assert.equal(statement?.kind, 'DiscardStatement');
	if (statement?.kind !== 'DiscardStatement' || statement.expression.kind !== 'FieldExpression') throw new Error('expected field expression');

	const currentProperty: ForeignUsage = {
		kind: 'property',
		nodeId: statement.expression.id,
		span: statement.expression.span,
		foreignType: {
			ref: { providerId: 'test', generation: 1, id: 'number' },
			display: 'number',
			category: 'primitive',
			primitive: 'number',
			origin: { moduleSpecifier: './library.js', exportName: 'value' },
		},
	};
	const staleProperty: ForeignUsageIR = {
		kind: 'property',
		nodeId: statement.expression.id,
		span: statement.expression.span,
		foreignType: stableString,
	};
	assert.throws(
		() => externalOperationSequence({ module: parsed.ast!, interop: interop([currentProperty], [staleProperty]), diagnostics: [] }),
		/Stale or cross-session External usage evidence/u,
	);
});

test('an expression without the matching checker bridge marker cannot accept stale primitive-bridge evidence', () => {
	const parsed = parseSource({
		id: 1,
		path: '/virtual/main.virune',
		text: 'fn main() -> Unit {\n\tdiscard value\n}\n',
	});
	assert.ok(parsed.ast);
	const declaration = parsed.ast.declarations[0];
	assert.equal(declaration?.kind, 'FunctionDeclaration');
	if (declaration?.kind !== 'FunctionDeclaration' || declaration.body.kind !== 'BlockStatement') throw new Error('expected function block');
	const statement = declaration.body.statements[0];
	assert.equal(statement?.kind, 'DiscardStatement');
	if (statement?.kind !== 'DiscardStatement') throw new Error('expected discard statement');
	assert.equal(statement.expression.foreignBridge, undefined);

	const staleBridge: ForeignUsageIR = {
		kind: 'bridge',
		nodeId: statement.expression.id,
		span: statement.expression.span,
		foreignType: stableString,
		bridge: { kind: 'primitive', bridge: 'string', targetType: 1 },
	};
	assert.throws(
		() => externalOperationSequence({ module: parsed.ast!, interop: emptyInterop([staleBridge]), diagnostics: [] }),
		/Stale or cross-session External usage evidence/u,
	);
});
