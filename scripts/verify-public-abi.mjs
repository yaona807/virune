import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const snapshotPath = resolve(repositoryRoot, 'packages/public-abi.snapshot.json');
const packageRoots = [
	resolve(repositoryRoot, 'packages/runtime'),
	resolve(repositoryRoot, 'packages/js-interop'),
	resolve(repositoryRoot, 'packages/stdlib'),
];
const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed, removeComments: true });

export async function verifyPublicAbi({ write = false } = {}) {
	const actual = await buildSnapshot();
	if (write) {
		await writeFile(snapshotPath, `${JSON.stringify(actual, null, '\t')}\n`, 'utf8');
		console.log(`Updated ${snapshotPath}`);
		return actual;
	}
	const expected = JSON.parse(await readFile(snapshotPath, 'utf8'));
	const changes = compareSnapshots(expected, actual);
	if (changes.length > 0) {
		for (const change of changes) console.error(`${change.kind}: ${change.message}`);
		throw new Error('Public ABI snapshot changed. Run npm run abi:update and review the compatibility impact.');
	}
	console.log(`Verified public ABI for ${Object.keys(actual.packages).length} packages and ${actual.emitterRuntimeSymbols.length} emitter runtime symbols.`);
	return actual;
}

async function buildSnapshot() {
	const packages = {};
	for (const packageRoot of packageRoots) {
		const manifest = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8'));
		const entries = {};
		for (const [entry, targetValue] of Object.entries(manifest.exports ?? {}).sort(([left], [right]) => left.localeCompare(right))) {
			if (typeof targetValue !== 'string') throw new Error(`${manifest.name} export ${entry} must resolve to a string`);
			const source = sourceForExport(packageRoot, targetValue);
			entries[entry] = {
				source: relativePackagePath(packageRoot, source),
				exports: Object.fromEntries([...await collectExports(source, new Set())].sort(([left], [right]) => left.localeCompare(right))),
			};
		}
		packages[manifest.name] = {
			packageExports: Object.fromEntries(Object.entries(manifest.exports ?? {}).sort(([left], [right]) => left.localeCompare(right))),
			entries,
		};
	}
	const emitterRuntimeSymbols = await readEmitterRuntimeSymbols();
	const runtimeExports = new Set(Object.keys(packages['@virune/runtime'].entries['.'].exports));
	const missing = emitterRuntimeSymbols.filter(symbol => !runtimeExports.has(symbol));
	if (missing.length > 0) throw new Error(`Emitter references runtime symbols outside the public Runtime v2 ABI: ${missing.join(', ')}`);
	return { schemaVersion: 1, packages, emitterRuntimeSymbols };
}

async function collectExports(file, stack) {
	const normalized = resolve(file);
	if (stack.has(normalized)) throw new Error(`Circular public re-export while reading ${normalized}`);
	const nextStack = new Set(stack).add(normalized);
	const sourceText = await readFile(normalized, 'utf8');
	const sourceFile = ts.createSourceFile(normalized, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
	const local = new Map();
	const exported = new Map();
	for (const statement of sourceFile.statements) {
		for (const [name, signature] of declarationEntries(statement, sourceFile)) {
			local.set(name, signature);
			if (hasModifier(statement, ts.SyntaxKind.ExportKeyword)) exported.set(name, signature);
		}
	}
	for (const statement of sourceFile.statements) {
		if (!ts.isExportDeclaration(statement)) continue;
		const target = statement.moduleSpecifier === undefined ? undefined : resolveModule(normalized, statement.moduleSpecifier.text);
		if (statement.exportClause === undefined) {
			if (target === undefined) throw new Error(`export * without a module in ${normalized}`);
			for (const [name, signature] of await collectExports(target, nextStack)) exported.set(name, signature);
			continue;
		}
		if (ts.isNamespaceExport(statement.exportClause)) {
			if (target === undefined) throw new Error(`Namespace export requires a module in ${normalized}`);
			const namespaceExports = Object.fromEntries([...await collectExports(target, nextStack)].sort(([left], [right]) => left.localeCompare(right)));
			exported.set(statement.exportClause.name.text, `namespace ${statement.exportClause.name.text} ${JSON.stringify(namespaceExports)}`);
			continue;
		}
		if (!ts.isNamedExports(statement.exportClause)) throw new Error(`Unsupported export clause in ${normalized}`);
		const targetExports = target === undefined ? undefined : await collectExports(target, nextStack);
		for (const element of statement.exportClause.elements) {
			const original = element.propertyName?.text ?? element.name.text;
			const signature = targetExports?.get(original) ?? local.get(original);
			if (signature === undefined) throw new Error(`Unable to resolve public export ${original} in ${normalized}`);
			exported.set(element.name.text, signature.replace(new RegExp(`\\b${escapeRegExp(original)}\\b`, 'u'), element.name.text));
		}
	}
	return exported;
}

function declarationEntries(statement, sourceFile) {
	if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
		return [[statement.name.text, normalize(printNode(ts.factory.updateFunctionDeclaration(statement, statement.modifiers, statement.asteriskToken, statement.name, statement.typeParameters, statement.parameters, statement.type, undefined), sourceFile))]];
	}
	if (ts.isClassDeclaration(statement) && statement.name !== undefined) {
		const members = statement.members.filter(isPublicClassMember).map(stripClassMemberBody);
		const updated = ts.factory.updateClassDeclaration(statement, statement.modifiers, statement.name, statement.typeParameters, statement.heritageClauses, members);
		return [[statement.name.text, normalize(printNode(updated, sourceFile))]];
	}
	if ((ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name !== undefined) {
		return [[statement.name.text, normalize(printNode(statement, sourceFile))]];
	}
	if (ts.isVariableStatement(statement)) {
		return statement.declarationList.declarations.flatMap(declaration => {
			if (!ts.isIdentifier(declaration.name)) return [];
			return [[declaration.name.text, variableSignature(statement, declaration, sourceFile)]];
		});
	}
	return [];
}

function variableSignature(statement, declaration, sourceFile) {
	const declarationKind = (statement.declarationList.flags & ts.NodeFlags.Const) !== 0 ? 'const' : (statement.declarationList.flags & ts.NodeFlags.Let) !== 0 ? 'let' : 'var';
	const modifiers = hasModifier(statement, ts.SyntaxKind.ExportKeyword) ? 'export ' : '';
	if (declaration.type !== undefined) return normalize(`${modifiers}${declarationKind} ${declaration.name.text}: ${declaration.type.getText(sourceFile)}`);
	const initializer = declaration.initializer;
	if (initializer !== undefined && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))) {
		const typeParameters = initializer.typeParameters === undefined ? '' : `<${initializer.typeParameters.map(item => item.getText(sourceFile)).join(', ')}>`;
		const parameters = initializer.parameters.map(parameter => parameter.getText(sourceFile).replace(/\s*=.*$/su, '')).join(', ');
		const result = initializer.type?.getText(sourceFile) ?? '<inferred>';
		return normalize(`${modifiers}${declarationKind} ${declaration.name.text}: ${typeParameters}(${parameters}) => ${result}`);
	}
	if (initializer !== undefined && ts.isIdentifier(initializer)) return normalize(`${modifiers}${declarationKind} ${declaration.name.text}: alias ${initializer.text}`);
	return normalize(`${modifiers}${declarationKind} ${declaration.name.text}: ${initializer?.getText(sourceFile) ?? '<uninitialized>'}`);
}

function isPublicClassMember(member) {
	if (member.name !== undefined && ts.isPrivateIdentifier(member.name)) return false;
	return !hasModifier(member, ts.SyntaxKind.PrivateKeyword) && !hasModifier(member, ts.SyntaxKind.ProtectedKeyword);
}

function stripClassMemberBody(member) {
	if (ts.isConstructorDeclaration(member)) return ts.factory.updateConstructorDeclaration(member, member.modifiers, member.parameters, undefined);
	if (ts.isMethodDeclaration(member)) return ts.factory.updateMethodDeclaration(member, member.modifiers, member.asteriskToken, member.name, member.questionToken, member.typeParameters, member.parameters, member.type, undefined);
	if (ts.isGetAccessorDeclaration(member)) return ts.factory.updateGetAccessorDeclaration(member, member.modifiers, member.name, member.parameters, member.type, undefined);
	if (ts.isSetAccessorDeclaration(member)) return ts.factory.updateSetAccessorDeclaration(member, member.modifiers, member.name, member.parameters, undefined);
	if (ts.isPropertyDeclaration(member)) return ts.factory.updatePropertyDeclaration(member, member.modifiers, member.name, member.questionToken ?? member.exclamationToken, member.type, undefined);
	return member;
}

async function readEmitterRuntimeSymbols() {
	const source = await readFile(resolve(repositoryRoot, 'packages/compiler/src/codegen/runtime-imports.ts'), 'utf8');
	const match = /import \{ ([^}]+) \} from '@virune\/runtime\/v2\/index\.js';/u.exec(source);
	if (match?.[1] === undefined) throw new Error('Unable to locate the Runtime v2 import emitted by the compiler');
	return match[1].split(',').map(item => item.trim()).filter(Boolean).sort();
}

function sourceForExport(packageRoot, target) {
	const match = /^\.\/dist\/src\/(.+)\.js$/u.exec(target);
	if (match?.[1] === undefined) throw new Error(`Unsupported package export target: ${target}`);
	return resolve(packageRoot, 'src', `${match[1]}.ts`);
}

function resolveModule(fromFile, specifier) {
	if (!specifier.startsWith('.')) throw new Error(`Public ABI re-export must be relative: ${specifier}`);
	return resolve(dirname(fromFile), specifier.replace(/\.js$/u, '.ts'));
}

function relativePackagePath(packageRoot, file) {
	return file.slice(packageRoot.length + 1).replaceAll('\\', '/');
}

function hasModifier(node, kind) {
	return node.modifiers?.some(modifier => modifier.kind === kind) ?? false;
}

function printNode(node, sourceFile) {
	return printer.printNode(ts.EmitHint.Unspecified, node, sourceFile);
}

function normalize(value) {
	return value.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/.*$/gmu, '').replace(/\s+/gu, ' ').trim().replace(/;$/u, '');
}

export function compareSnapshots(expected, current) {
	const changes = [];
	if (expected.schemaVersion !== current.schemaVersion) changes.push({ kind: 'BREAKING', message: `schemaVersion ${expected.schemaVersion} -> ${current.schemaVersion}` });
	for (const packageName of new Set([...Object.keys(expected.packages ?? {}), ...Object.keys(current.packages ?? {})])) {
		const beforePackage = expected.packages?.[packageName];
		const afterPackage = current.packages?.[packageName];
		if (beforePackage === undefined) { changes.push({ kind: 'ADDITIVE', message: `package added: ${packageName}` }); continue; }
		if (afterPackage === undefined) { changes.push({ kind: 'BREAKING', message: `package removed: ${packageName}` }); continue; }
		compareValue(changes, `${packageName} package exports`, beforePackage.packageExports, afterPackage.packageExports);
		for (const entry of new Set([...Object.keys(beforePackage.entries), ...Object.keys(afterPackage.entries)])) {
			const before = beforePackage.entries[entry]?.exports;
			const after = afterPackage.entries[entry]?.exports;
			if (before === undefined) { changes.push({ kind: 'ADDITIVE', message: `${packageName} entry added: ${entry}` }); continue; }
			if (after === undefined) { changes.push({ kind: 'BREAKING', message: `${packageName} entry removed: ${entry}` }); continue; }
			for (const symbol of new Set([...Object.keys(before), ...Object.keys(after)])) {
				if (!(symbol in before)) changes.push({ kind: 'ADDITIVE', message: `${packageName}${entry} export added: ${symbol}` });
				else if (!(symbol in after)) changes.push({ kind: 'BREAKING', message: `${packageName}${entry} export removed: ${symbol}` });
				else if (before[symbol] !== after[symbol]) changes.push({ kind: 'BREAKING', message: `${packageName}${entry} signature changed: ${symbol}` });
			}
		}
	}
	compareValue(changes, 'emitter Runtime v2 symbols', expected.emitterRuntimeSymbols, current.emitterRuntimeSymbols);
	return changes;
}

function compareValue(changes, label, before, after) {
	if (JSON.stringify(before) !== JSON.stringify(after)) changes.push({ kind: 'BREAKING', message: `${label} changed` });
}

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

const entry = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (entry === fileURLToPath(import.meta.url)) await verifyPublicAbi({ write: process.argv.includes('--write') });
