import assert from 'node:assert/strict';
import test from 'node:test';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { ProjectManager } from '../src/analysis/project-manager.js';
import { filePathToUri, fullDocumentRange, positionToOffset } from '../src/analysis/position.js';
import { definitionAt } from '../src/features/definition.js';
import { documentSymbols } from '../src/features/document-symbols.js';
import { formattingEdits } from '../src/features/formatting.js';
import { hoverAt } from '../src/features/hover.js';
import { inlayHints } from '../src/features/inlay-hints.js';
import { signatureHelpAt } from '../src/features/signature-help.js';

const path = '/tmp/virune-language-server-features.virune';
const text = `record User {
	name: String
}

fn value() -> Int => 1

fn use() -> Int => value()
`;

async function analyze() {
	return analyzeSource(path, text);
}

async function analyzeSource(sourcePath: string, sourceText: string) {
	const document = TextDocument.create(filePathToUri(sourcePath), 'virune', 1, sourceText);
	const manager = new ProjectManager({ getOpenDocuments: () => [document] });
	const snapshot = await manager.analyze(document.uri);
	assert.ok(snapshot);
	const module = snapshot.modulesByPath.get(sourcePath);
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
	assert.match(JSON.stringify(hover.contents), /fn value\(\) -> Int/u);
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

test('inlayHints displays inferred variable, function, lambda, and parameter information', async () => {
	const sourcePath = '/tmp/virune-language-server-inlay-hints.virune';
	const sourceText = `fn add(left: Int, right: Int) -> Int => left + right

fn apply(callback: fn(Int) -> Int) -> Int => callback(1)

fn inferred() {
	let total = add(1, 2)
	let mapped = apply(fn(value) => value)
	return total + mapped
}
`;
	const { module } = await analyzeSource(sourcePath, sourceText);
	const hints = inlayHints(module, fullDocumentRange(module.source));
	const labels = hints.map(hint => String(hint.label));
	assert.equal(labels.includes('left:'), true);
	assert.equal(labels.includes('right:'), true);
	assert.equal(labels.includes(': Int'), true);
	assert.equal(labels.filter(label => label === ' -> Int').length >= 2, true);
	assert.equal(hints.every(hint => hint.position.line >= 0 && hint.position.character >= 0), true);
});

test('signatureHelpAt reports the active function parameter', async () => {
	const sourcePath = '/tmp/virune-language-server-signature-help.virune';
	const sourceText = `fn add(left: Int, right: Int) -> Int => left + right

fn use() -> Int => add(1, 2)
`;
	const { module } = await analyzeSource(sourcePath, sourceText);
	const offset = sourceText.lastIndexOf('2');
	const help = signatureHelpAt(module, module.source, offset);
	assert.ok(help);
	assert.match(help.signatures[0]?.label ?? '', /fn add\(left: Int, right: Int\) -> Int/u);
	assert.equal(help.activeParameter, 1);
	assert.deepEqual(help.signatures[0]?.parameters?.map(parameter => parameter.label), ['left: Int', 'right: Int']);
});

test('hoverAt displays record shape and definition source', async () => {
	const sourcePath = '/tmp/virune-language-server-hover-record.virune';
	const sourceText = `record User {
	name: String
	age: Int
}
`;
	const { snapshot, module } = await analyzeSource(sourcePath, sourceText);
	const hover = hoverAt(module, module.source, sourceText.indexOf('User'), { sourcesById: snapshot.sourcesById });
	assert.ok(hover);
	const contents = JSON.stringify(hover.contents);
	assert.match(contents, /record User/u);
	assert.match(contents, /name: String/u);
	assert.match(contents, /Defined in/u);
});
