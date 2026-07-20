import assert from 'node:assert/strict';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { Diagnostic } from 'vscode-languageserver/node';
import { ProjectManager, type AnalysisSnapshot } from '../src/analysis/project-manager.js';
import { filePathToUri } from '../src/analysis/position.js';
import { codeActionsForDiagnostics, documentationCodeActions } from '../src/features/code-actions.js';
import { completionItems } from '../src/features/completion.js';
import { semanticTokens, semanticTokenTypes } from '../src/features/semantic-tokens.js';

async function analyze(path: string, text: string) {
	const document = TextDocument.create(filePathToUri(path), 'virune', 1, text);
	const manager = new ProjectManager({ getOpenDocuments: () => [document] });
	const snapshot = await manager.analyze(document.uri);
	assert.ok(snapshot);
	const module = snapshot.modulesByPath.get(snapshot.requestedPath);
	assert.ok(module);
	return { document, snapshot, module };
}

test('completionItems limits local variables and parameters to the current function scope', async () => {
	const path = join(tmpdir(), 'virune-completion-scope.virune');
	const text = `fn first(a: Int) -> Int {
	let x = a
	return x
}

fn second(b: Int) -> Int {
	let y = b
	return y
}
`;
	const { module } = await analyze(path, text);
	const items = completionItems(module, module.source, text.lastIndexOf('y'));
	const labels = new Set(items.map(item => item.label));
	assert.equal(labels.has('b'), true);
	assert.equal(labels.has('y'), true);
	assert.equal(labels.has('a'), false);
	assert.equal(labels.has('x'), false);
	assert.equal(labels.has('fn'), true);
});

test('completionItems offers fields for a typed receiver', async () => {
	const path = join(tmpdir(), 'virune-completion-field.virune');
	const text = `record User {
	name: String
}

fn read(user: User) -> String => user.name
`;
	const { module } = await analyze(path, text);
	const offset = text.indexOf('name', text.indexOf('user.name'));
	const items = completionItems(module, module.source, offset);
	assert.deepEqual(items.map(item => item.label), ['name']);
});

test('semanticTokens classifies declarations and references', async () => {
	const path = join(tmpdir(), 'virune-semantic-tokens.virune');
	const text = `record User {
	name: String
}

fn greet(user: User) -> String => user.name
`;
	const { module } = await analyze(path, text);
	const tokens = decodeTokens(semanticTokens(module).data);
	const types = new Set(tokens.map(token => semanticTokenTypes[token.type]));
	assert.equal(types.has('type'), true);
	assert.equal(types.has('function'), true);
	assert.equal(types.has('parameter'), true);
	assert.equal(types.has('property'), true);
	const lines = text.split('\n');
	const typeLexemes = tokens
		.filter(token => semanticTokenTypes[token.type] === 'type')
		.map(token => lines[token.line]?.slice(token.character, token.character + token.length));
	assert.equal(typeLexemes.includes('User'), true);
	assert.equal(typeLexemes.includes('String'), true);
	assert.equal(typeLexemes.every(value => value === 'User' || value === 'String'), true);
});

test('codeActionsForDiagnostics converts compiler fixes into workspace edits', async () => {
	const path = join(tmpdir(), 'virune-code-action.virune');
	const text = 'fn value() -> Int => 1\n';
	const { snapshot, module } = await analyze(path, text);
	const compilerDiagnostic = {
		code: 'LTEST',
		severity: 'error' as const,
		message: 'Replace value',
		span: {
			fileId: module.source.id,
			start: { offset: 3, line: 1, column: 4 },
			end: { offset: 8, line: 1, column: 9 },
		},
		fixes: [{
			title: 'Rename to result',
			kind: 'replace' as const,
			text: 'result',
		}],
	};
	const modifiedSnapshot: AnalysisSnapshot = {
		...snapshot,
		result: { ...snapshot.result, diagnostics: [compilerDiagnostic] },
	};
	const requested: Diagnostic = {
		code: 'LTEST',
		message: 'Replace value',
		range: { start: { line: 0, character: 3 }, end: { line: 0, character: 8 } },
	};
	const actions = codeActionsForDiagnostics(modifiedSnapshot, snapshot.requestedPath, [requested]);
	assert.equal(actions.length, 1);
	assert.equal(actions[0]?.title, 'Rename to result');
	assert.equal(actions[0]?.edit?.changes?.[filePathToUri(module.source.path)]?.[0]?.newText, 'result');
});

function decodeTokens(data: readonly number[]): Array<{ line: number; character: number; length: number; type: number; modifiers: number }> {
	const result = [];
	let line = 0;
	let character = 0;
	for (let index = 0; index < data.length; index += 5) {
		const deltaLine = data[index] ?? 0;
		const deltaCharacter = data[index + 1] ?? 0;
		line += deltaLine;
		character = deltaLine === 0 ? character + deltaCharacter : deltaCharacter;
		result.push({
			line,
			character,
			length: data[index + 2] ?? 0,
			type: data[index + 3] ?? 0,
			modifiers: data[index + 4] ?? 0,
		});
	}
	return result;
}

test('completionItems exposes the first documentation paragraph as a summary', async () => {
	const path = join(tmpdir(), 'virune-completion-documentation.virune');
	const text = `/// Computes a stable value.
///
/// This detail is intentionally omitted from completion.
fn documented() -> Int => 1

fn use() -> Int => documented()
`;
	const { module } = await analyze(path, text);
	const items = completionItems(module, module.source, text.lastIndexOf('documented'));
	const documented = items.find(item => item.label === 'documented');
	assert.ok(documented);
	assert.match(JSON.stringify(documented.documentation), /Computes a stable value/u);
	assert.doesNotMatch(JSON.stringify(documented.documentation), /intentionally omitted/u);
});

test('documentationCodeActions generate declaration and module comments', async () => {
	const path = join(tmpdir(), 'virune-documentation-code-action.virune');
	const text = 'fn value() -> Int => 1\n';
	const { module } = await analyze(path, text);
	const declarationActions = documentationCodeActions(module, module.source, 0);
	const declaration = declarationActions.find(action => action.title === 'Generate documentation comment');
	const moduleAction = declarationActions.find(action => action.title === 'Generate module documentation');
	assert.equal(declaration?.edit?.changes?.[filePathToUri(path)]?.[0]?.newText, '/// TODO: Describe `value`.\n');
	assert.equal(moduleAction?.edit?.changes?.[filePathToUri(path)]?.[0]?.newText, '//! TODO: Describe this module.\n\n');
});

test('documentationCodeActions omit comments for already documented declarations', async () => {
	const path = join(tmpdir(), 'virune-existing-documentation-code-action.virune');
	const text = '/// Existing documentation.\nfn value() -> Int => 1\n';
	const { module } = await analyze(path, text);
	const actions = documentationCodeActions(module, module.source, 1);
	assert.equal(actions.some(action => action.title === 'Generate documentation comment'), false);
});


test('record field completion exposes documentation summaries', async () => {
	const path = join(tmpdir(), 'virune-field-completion-documentation.virune');
	const text = `record User {
	/// Stable display name.
	name: String
}

fn read(user: User) -> String => user.name
`;
	const { module } = await analyze(path, text);
	const items = completionItems(module, module.source, text.lastIndexOf('name'));
	const name = items.find(item => item.label === 'name');
	assert.ok(name);
	assert.match(JSON.stringify(name.documentation), /Stable display name/u);
});
