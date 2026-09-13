import assert from 'node:assert/strict';
import test from 'node:test';
import type { ComponentDeclaration, ReturnStatement, ViewExpression } from '../src/ast/nodes.js';
import { parseSource } from '../src/project/project.js';

const source = (text: string) => ({ id: 1, path: 'repetition-identity.virune', text });
const parseErrors = (text: string) => parseSource(source(text)).diagnostics.filter(item => item.severity === 'error');

// @virune-rule {"id":"frontend.view-repetition","runner":"unit","file":"packages/compiler/test/view-repetition-identity-syntax.test.ts","case":"View repetition preserves optional by identity expression","kind":"positive","platform":"common"}
test('View repetition preserves optional by identity expression', () => {
	const parsed = parseSource(source(`component ListView() uses JavaScript {
	let items = [1, 2]
	return view {
		for item, index in items by item {
			span(value: item, position: index)
		}
	}
}
`));
	assert.deepEqual(parsed.diagnostics.filter(item => item.severity === 'error'), []);
	const component = parsed.ast?.declarations.find((declaration): declaration is ComponentDeclaration => declaration.kind === 'ComponentDeclaration');
	assert.ok(component);
	const returned = component.body.statements[1] as ReturnStatement;
	const view = returned.value as ViewExpression;
	const repetition = view.body.children[0];
	assert.equal(repetition?.kind, 'ViewRepetition');
	if (repetition?.kind !== 'ViewRepetition') throw new Error('expected ViewRepetition');
	assert.equal(repetition.itemName, 'item');
	assert.equal(repetition.indexName, 'index');
	assert.equal(repetition.source.kind, 'IdentifierExpression');
	assert.equal(repetition.source.kind === 'IdentifierExpression' ? repetition.source.name : undefined, 'items');
	assert.equal(repetition.identity?.kind, 'IdentifierExpression');
	assert.equal(repetition.identity?.kind === 'IdentifierExpression' ? repetition.identity.name : undefined, 'item');
});

test('View repetition by works without an index binding', () => {
	const parsed = parseSource(source(`component ListView() uses JavaScript {
	let items = [1, 2]
	return view {
		for item in items by item {
			span(value: item)
		}
	}
}
`));
	assert.deepEqual(parsed.diagnostics.filter(item => item.severity === 'error'), []);
	const component = parsed.ast?.declarations.find((declaration): declaration is ComponentDeclaration => declaration.kind === 'ComponentDeclaration');
	assert.ok(component);
	const returned = component.body.statements[1] as ReturnStatement;
	const view = returned.value as ViewExpression;
	const repetition = view.body.children[0];
	assert.equal(repetition?.kind, 'ViewRepetition');
	if (repetition?.kind !== 'ViewRepetition') throw new Error('expected ViewRepetition');
	assert.equal(repetition.indexName, undefined);
	assert.equal(repetition.identity?.kind, 'IdentifierExpression');
});

test('by remains an ordinary identifier outside View repetition', () => {
	assert.deepEqual(parseErrors(`fn identity(by: Int) -> Int {
	return by
}
`), []);
});

test('imperative for does not accept View repetition by syntax', () => {
	assert.ok(parseErrors(`fn walk(items: List<Int>) -> Unit {
	for item in items by item {
		discard item
	}
	return Unit
}
`).length > 0);
});
