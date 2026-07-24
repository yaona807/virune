import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { ProjectManager } from '../src/analysis/project-manager.js';
import { filePathToUri, offsetToPosition } from '../src/analysis/position.js';
import { completionItems } from '../src/features/completion.js';
import { codeLenses } from '../src/features/code-lens.js';
import { defaultEditorInformationSettings } from '../src/editor-information.js';
import { organizeImportsAction } from '../src/features/imports.js';
import {
	declarationAt,
	definitionAt,
	documentHighlightsAt,
	incomingCalls,
	outgoingCalls,
	prepareCallHierarchyAt,
	referencesAt,
	renameAt,
	typeDefinitionAt,
} from '../src/features/navigation.js';
import { workspaceSymbols } from '../src/features/workspace-symbols.js';

async function projectFixture(t: TestContext) {
	const root = await mkdtemp(join(tmpdir(), 'virune-semantic-navigation-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const sourceDirectory = join(root, 'src');
	await mkdir(sourceDirectory);
	await writeFile(join(root, 'virune.json'), JSON.stringify({
		languageVersion: '1.0',
		platform: 'node',
		sourceDir: 'src',
		outDir: 'dist',
		entry: 'src/main.virune',
		target: 'es2022',
		sourceMap: true,
		sourcesContent: true,
	}));
	const utilityPath = join(sourceDirectory, 'utility.virune');
	const barrelPath = join(sourceDirectory, 'barrel.virune');
	const mainPath = join(sourceDirectory, 'main.virune');
	const consumerPath = join(sourceDirectory, 'consumer.virune');
	const utilityText = `pub record User {
	name: String
}

pub fn helper(value: Int) -> Int => value + 1

pub enum Status {
	Active
	Inactive
}
`;
	const barrelText = `pub import { helper, User, Status } from "./utility.virune"
`;
	const mainText = `import { helper as runHelper, User, Status } from "./barrel.virune"

pub fn caller(user: User) -> Int => runHelper(1)
pub fn userName(user: User) -> String => user.name
pub fn defaultUser() -> User => User { name: "Virune" }
pub fn userFromName(name: String) -> User => User { name }
pub fn activeStatus() -> Status => Status.Active
pub fn localValue() -> Int {
	let mut total = 1
	total = total + 1
	return total
}
`;
	const consumerText = 'pub fn orphanUtility() -> Int => 1\n';
	await writeFile(utilityPath, utilityText);
	await writeFile(barrelPath, barrelText);
	await writeFile(mainPath, mainText);
	await writeFile(consumerPath, consumerText);
	const documents = [TextDocument.create(filePathToUri(mainPath), 'virune', 1, mainText)];
	const manager = new ProjectManager({ getOpenDocuments: () => documents, workspaceFolders: [root] });
	const snapshot = await manager.analyze(documents[0]!.uri);
	assert.ok(snapshot);
	assert.equal(snapshot.result.diagnostics.filter(diagnostic => diagnostic.severity === 'error').length, 0);
	const main = snapshot.modulesByPath.get(mainPath);
	const utility = snapshot.modulesByPath.get(utilityPath);
	const consumer = snapshot.modulesByPath.get(consumerPath);
	assert.ok(main);
	assert.ok(utility);
	assert.ok(consumer);
	return { root, snapshot, main, utility, consumer, mainPath, utilityPath, consumerPath, mainText, utilityText, consumerText };
}

test('semantic navigation follows aliases and re-exports to the original definition', async t => {
	const fixture = await projectFixture(t);
	const callOffset = fixture.mainText.lastIndexOf('runHelper');
	const position = offsetToPosition(fixture.main.source, callOffset);
	const declaration = declarationAt(fixture.snapshot, filePathToUri(fixture.mainPath), position);
	assert.ok(declaration);
	assert.equal(declaration.targetUri, filePathToUri(fixture.mainPath));
	assert.equal(declaration.targetSelectionRange.start.line, 0);
	assert.equal(declaration.targetSelectionRange.start.character > 0, true);
	const definition = definitionAt(fixture.snapshot, filePathToUri(fixture.mainPath), position);
	assert.ok(definition);
	assert.equal(definition.targetUri, filePathToUri(fixture.utilityPath));
	assert.equal(definition.targetSelectionRange.start.line, 4);
	const references = referencesAt(fixture.snapshot, filePathToUri(fixture.mainPath), position, true);
	assert.equal(references.some(location => location.uri === filePathToUri(fixture.utilityPath)), true);
	assert.equal(references.some(location => location.uri === filePathToUri(fixture.mainPath)), true);
	const highlights = documentHighlightsAt(fixture.snapshot, filePathToUri(fixture.mainPath), position);
	assert.equal(highlights.length >= 2, true);
});

test('type definition resolves imported record types', async t => {
	const fixture = await projectFixture(t);
	const offset = fixture.mainText.indexOf('User', fixture.mainText.indexOf('caller'));
	const definition = typeDefinitionAt(
		fixture.snapshot,
		filePathToUri(fixture.mainPath),
		offsetToPosition(fixture.main.source, offset),
	);
	assert.ok(definition);
	assert.equal(definition.targetUri, filePathToUri(fixture.utilityPath));
	assert.equal(definition.targetSelectionRange.start.line, 0);
});


test('local variables expose definitions, read/write highlights, and safe rename edits', async t => {
	const fixture = await projectFixture(t);
	const returnOffset = fixture.mainText.lastIndexOf('total');
	const position = offsetToPosition(fixture.main.source, returnOffset);
	const definition = definitionAt(fixture.snapshot, filePathToUri(fixture.mainPath), position);
	assert.ok(definition);
	assert.equal(definition.targetUri, filePathToUri(fixture.mainPath));
	const highlights = documentHighlightsAt(fixture.snapshot, filePathToUri(fixture.mainPath), position);
	assert.equal(highlights.length >= 4, true);
	assert.equal(new Set(highlights.map(highlight => highlight.kind)).size >= 2, true);
	const edit = renameAt(fixture.snapshot, filePathToUri(fixture.mainPath), position, 'count');
	assert.ok(edit?.changes);
	assert.equal((edit.changes[filePathToUri(fixture.mainPath)]?.length ?? 0) >= 4, true);
});

test('record fields and enum variants support definition, references, and rename', async t => {
	const fixture = await projectFixture(t);
	const fieldOffset = fixture.mainText.indexOf('name', fixture.mainText.indexOf('user.name'));
	const fieldPosition = offsetToPosition(fixture.main.source, fieldOffset);
	const fieldDefinition = definitionAt(fixture.snapshot, filePathToUri(fixture.mainPath), fieldPosition);
	assert.ok(fieldDefinition);
	assert.equal(fieldDefinition.targetUri, filePathToUri(fixture.utilityPath));
	assert.equal(fieldDefinition.targetSelectionRange.start.line, 1);
	const fieldReferences = referencesAt(fixture.snapshot, filePathToUri(fixture.mainPath), fieldPosition, true);
	assert.equal(fieldReferences.length >= 3, true);
	const fieldRename = renameAt(fixture.snapshot, filePathToUri(fixture.mainPath), fieldPosition, 'displayName');
	assert.ok(fieldRename?.changes);
	assert.equal((fieldRename.changes[filePathToUri(fixture.utilityPath)]?.length ?? 0) > 0, true);
	const mainFieldEdits = fieldRename.changes[filePathToUri(fixture.mainPath)] ?? [];
	assert.equal(mainFieldEdits.length >= 3, true);
	assert.equal(mainFieldEdits.some(edit => edit.newText === 'displayName: name'), true);

	const variantOffset = fixture.mainText.lastIndexOf('Active');
	const variantDefinition = definitionAt(
		fixture.snapshot,
		filePathToUri(fixture.mainPath),
		offsetToPosition(fixture.main.source, variantOffset),
	);
	assert.ok(variantDefinition);
	assert.equal(variantDefinition.targetUri, filePathToUri(fixture.utilityPath));
	assert.equal(variantDefinition.targetSelectionRange.start.line, 7);
});

test('call hierarchy reports incoming and outgoing calls across modules', async t => {
	const fixture = await projectFixture(t);
	const callerOffset = fixture.mainText.indexOf('caller');
	const [caller] = prepareCallHierarchyAt(
		fixture.snapshot,
		filePathToUri(fixture.mainPath),
		offsetToPosition(fixture.main.source, callerOffset),
	);
	assert.ok(caller);
	const outgoing = outgoingCalls(fixture.snapshot, caller);
	assert.deepEqual(outgoing.map(call => call.to.name), ['helper']);

	const helperOffset = fixture.utilityText.indexOf('helper');
	const [helper] = prepareCallHierarchyAt(
		fixture.snapshot,
		filePathToUri(fixture.utilityPath),
		offsetToPosition(fixture.utility.source, helperOffset),
	);
	assert.ok(helper);
	const incoming = incomingCalls(fixture.snapshot, helper);
	assert.deepEqual(incoming.map(call => call.from.name), ['caller']);
});

test('rename keeps import aliases local and renames canonical declarations across modules', async t => {
	const fixture = await projectFixture(t);
	const aliasOffset = fixture.mainText.lastIndexOf('runHelper');
	const aliasEdit = renameAt(
		fixture.snapshot,
		filePathToUri(fixture.mainPath),
		offsetToPosition(fixture.main.source, aliasOffset),
		'calculate',
	);
	assert.ok(aliasEdit?.changes);
	assert.equal(aliasEdit.changes[filePathToUri(fixture.utilityPath)], undefined);
	assert.equal((aliasEdit.changes[filePathToUri(fixture.mainPath)]?.length ?? 0) >= 2, true);

	const definitionOffset = fixture.utilityText.indexOf('helper');
	const definitionEdit = renameAt(
		fixture.snapshot,
		filePathToUri(fixture.utilityPath),
		offsetToPosition(fixture.utility.source, definitionOffset),
		'increment',
	);
	assert.ok(definitionEdit?.changes);
	assert.equal((definitionEdit.changes[filePathToUri(fixture.utilityPath)]?.length ?? 0) > 0, true);
	assert.equal((definitionEdit.changes[filePathToUri(fixture.mainPath)]?.length ?? 0) > 0, true);
});

test('workspace symbols, CodeLens, and auto imports use the semantic index', async t => {
	const fixture = await projectFixture(t);
	const symbols = workspaceSymbols([fixture.snapshot], 'help');
	assert.equal(symbols.some(symbol => symbol.name === 'helper'), true);
	const orphanSymbols = workspaceSymbols([fixture.snapshot], 'orphan');
	assert.equal(orphanSymbols.some(symbol => symbol.name === 'orphanUtility'), true);
	const lenses = codeLenses(fixture.snapshot, fixture.utility, {
		...defaultEditorInformationSettings,
		codeLens: {
			...defaultEditorInformationSettings.codeLens,
			references: true,
			callers: true,
		},
	});
	assert.equal(lenses.some(lens => lens.command?.title.includes('references') === true), true);
	assert.equal(lenses.some(lens => lens.command?.title.includes('callers') === true), true);
	const completions = completionItems(fixture.consumer, fixture.consumer.source, fixture.consumerText.length - 1, fixture.snapshot);
	const helper = completions.find(item => item.label === 'helper');
	assert.ok(helper);
	assert.match(helper.detail ?? '', /Auto import/u);
	assert.match(helper.additionalTextEdits?.[0]?.newText ?? '', /import \{ helper \}/u);
});

test('organize imports returns a deterministic source action', async t => {
	const fixture = await projectFixture(t);
	const source = `import { User } from "./utility.virune"
import { helper } from "./utility.virune"

fn value() -> Int => helper(1)
`;
	const path = join(fixture.root, 'src', 'imports.virune');
	await writeFile(path, source);
	const document = TextDocument.create(filePathToUri(path), 'virune', 1, source);
	const manager = new ProjectManager({ getOpenDocuments: () => [document], workspaceFolders: [fixture.root] });
	const snapshot = await manager.analyze(document.uri);
	assert.ok(snapshot);
	const module = snapshot.modulesByPath.get(path);
	assert.ok(module);
	const action = organizeImportsAction(module);
	assert.ok(action);
	assert.equal(action.kind, 'source.organizeImports');
});

test('JavaScript imports navigate to TypeScript declarations', async t => {
	const root = await mkdtemp(join(tmpdir(), 'virune-js-definition-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const sourceDirectory = join(root, 'src');
	await mkdir(sourceDirectory);
	await writeFile(join(root, 'virune.json'), JSON.stringify({
		languageVersion: '1.0', platform: 'node', sourceDir: 'src', outDir: 'dist', entry: 'src/main.virune', target: 'es2022', sourceMap: true, sourcesContent: true,
	}));
	const interopPath = join(sourceDirectory, 'math.interop.ts');
	const mainPath = join(sourceDirectory, 'main.virune');
	await writeFile(interopPath, 'export function increment(value: number): number { return value + 1; }\n');
	const text = `import js { increment } from "./math.interop.ts"

fn value() -> Unknown => increment(1)
`;
	await writeFile(mainPath, text);
	const document = TextDocument.create(filePathToUri(mainPath), 'virune', 1, text);
	const manager = new ProjectManager({ getOpenDocuments: () => [document], workspaceFolders: [root] });
	const snapshot = await manager.analyze(document.uri);
	assert.ok(snapshot);
	const module = snapshot.modulesByPath.get(mainPath);
	assert.ok(module);
	const offset = text.lastIndexOf('increment');
	const definition = definitionAt(snapshot, document.uri, offsetToPosition(module.source, offset));
	assert.ok(definition);
	assert.equal(definition.targetUri, filePathToUri(interopPath));
	assert.equal(definition.targetSelectionRange.start.line, 0);
});
