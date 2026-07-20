import assert from 'node:assert/strict';
import test from 'node:test';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { ProjectManager } from '../src/analysis/project-manager.js';
import { filePathToUri, positionToOffset } from '../src/analysis/position.js';
import { definitionAt } from '../src/features/definition.js';
import { documentSymbols } from '../src/features/document-symbols.js';
import { formattingEdits } from '../src/features/formatting.js';
import { hoverAt } from '../src/features/hover.js';

const path = '/tmp/virune-language-server-features.virune';
const text = `record User {
	name: String
}

fn value() -> Int => 1

fn use() -> Int => value()
`;

async function analyze() {
	const document = TextDocument.create(filePathToUri(path), 'virune', 1, text);
	const manager = new ProjectManager({ getOpenDocuments: () => [document] });
	const snapshot = await manager.analyze(document.uri);
	assert.ok(snapshot);
	const module = snapshot.modulesByPath.get(path);
	assert.ok(module);
	return { document, snapshot, module };
}

test('formattingEdits returns one whole-document replacement for unformatted source', () => {
	const edits = formattingEdits({ id: 1, path, text: 'fn value()->Int=>1' });
	assert.equal(edits.length, 1);
	assert.match(edits[0]?.newText ?? '', /fn value\(\) -> Int => 1/u);
});

test('documentSymbols exposes top-level declarations and record fields', async () => {
	const { module } = await analyze();
	const symbols = documentSymbols(module);
	assert.deepEqual(symbols.map(symbol => symbol.name), ['User', 'value', 'use']);
	assert.equal(symbols[0]?.children?.[0]?.name, 'name');
});

test('documentSymbols keeps selection ranges inside recovery spans', () => {
	const source = { id: 1, path, text: 'fn actual() -> Int => 1\n' };
	const recoverySpan = {
		fileId: source.id,
		start: { offset: 0, line: 1, column: 1 },
		end: { offset: 1, line: 1, column: 2 },
	};
	const module = {
		source,
		ast: {
			declarations: [{ kind: 'FunctionDeclaration', name: 'actual', span: recoverySpan }],
		},
	} as unknown as Parameters<typeof documentSymbols>[0];

	const [symbol] = documentSymbols(module);
	assert.ok(symbol);
	assert.deepEqual(symbol.selectionRange, symbol.range);
});

test('hoverAt reports an inferred function type', async () => {
	const { module } = await analyze();
	const offset = text.lastIndexOf('value');
	const hover = hoverAt(module, module.source, offset);
	assert.ok(hover);
	assert.match(JSON.stringify(hover.contents), /fn\(\) -> Int/u);
});

test('definitionAt resolves a function call to its declaration', async () => {
	const { document, snapshot, module } = await analyze();
	const offset = text.lastIndexOf('value');
	const location = definitionAt(snapshot, module, module.source, offset);
	assert.ok(location);
	assert.equal(location.uri, document.uri);
	assert.equal(location.range.start.line, 4);
	assert.equal(positionToOffset(module.source, location.range.start) <= text.indexOf('value'), true);
});
