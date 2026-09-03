import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { type ForeignTypeSnapshot, type InteropArgumentType, type JsInteropProvider } from '@virune/compiler/experimental';
import { TypeScriptInteropProvider } from '../src/index.js';
import { fixtureRoot } from './fixture.js';

function resolveNamed(provider: TypeScriptInteropProvider, root: string, importedName: string): ForeignTypeSnapshot {
	const imported = provider.resolveImport({ containingFile: join(root, 'src/main.virune'), moduleSpecifier: './library.js', kind: 'named', importedName, platform: 'node' });
	assert.ok(imported.type);
	return imported.type;
}

function call(provider: JsInteropProvider, callee: ForeignTypeSnapshot, argumentsList: readonly InteropArgumentType[]) {
	assert.ok(provider.resolveCallUsage);
	return provider.resolveCallUsage(callee.ref, { target: { kind: 'value' }, arguments: argumentsList });
}

test('diagnose DOM structural safety path', async () => {
	const root = await fixtureRoot();
	await writeFile(join(root, 'src/library.d.ts'), [
		'export interface NodeTypeOnly { readonly nodeType: number }',
		'export interface ParentLink { readonly nodeType: number; readonly parentNode: ParentLink | null }',
		'export interface FirstLink { readonly nodeType: number; readonly firstChild: FirstLink | null }',
		'export interface ChildrenLink { readonly nodeType: number; readonly childNodes: ArrayLike<ChildrenLink> }',
		'export interface ContainsLink { readonly nodeType: number; contains(other: ContainsLink | null): boolean }',
		'export interface InsertLink { readonly nodeType: number; insertBefore(node: InsertLink, child: InsertLink | null): InsertLink }',
		'export interface AppendLink { readonly nodeType: number; appendChild(node: AppendLink): AppendLink }',
		'export interface RemoveLink { readonly nodeType: number; removeChild(child: RemoveLink): RemoveLink }',
		'export declare function makeDomContainer(): HTMLDivElement;',
		'export declare function takeNodeType(value: NodeTypeOnly): void;',
		'export declare function takeParent(value: ParentLink): void;',
		'export declare function takeFirst(value: FirstLink): void;',
		'export declare function takeChildren(value: ChildrenLink): void;',
		'export declare function takeContains(value: ContainsLink): void;',
		'export declare function takeInsert(value: InsertLink): void;',
		'export declare function takeAppend(value: AppendLink): void;',
		'export declare function takeRemove(value: RemoveLink): void;',
		'',
	].join('\n'), 'utf8');
	await writeFile(join(root, 'src/library.js'), [
		'export function makeDomContainer() { return {}; }',
		'export function takeNodeType() {}',
		'export function takeParent() {}',
		'export function takeFirst() {}',
		'export function takeChildren() {}',
		'export function takeContains() {}',
		'export function takeInsert() {}',
		'export function takeAppend() {}',
		'export function takeRemove() {}',
		'',
	].join('\n'), 'utf8');

	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	const interopProvider: JsInteropProvider = provider;
	const container = call(interopProvider, resolveNamed(provider, root, 'makeDomContainer'), []);
	assert.ok(container);
	const arg = [{ kind: 'foreign', type: container.result.ref } as const];
	for (const name of ['takeNodeType', 'takeParent', 'takeFirst', 'takeChildren', 'takeContains', 'takeInsert', 'takeAppend', 'takeRemove']) {
		assert.ok(call(interopProvider, resolveNamed(provider, root, name), arg), `${name} must preserve TypeScript-proven structural assignment`);
	}
});
