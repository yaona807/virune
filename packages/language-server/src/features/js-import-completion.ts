import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CompletionItemKind, type CompletionItem, type Range } from 'vscode-languageserver/node';

export interface JsImportExportCompletion {
	readonly name: string;
	readonly kind: string;
}

export type JsImportExportResolver = (
	moduleSpecifier: string,
	typeOnly: boolean,
) => readonly JsImportExportCompletion[] | Promise<readonly JsImportExportCompletion[]>;

interface ModuleSpecifierContext {
	readonly kind: 'module';
	readonly prefix: string;
	readonly replaceStart: number;
	readonly replaceEnd: number;
}

interface NamedExportContext {
	readonly kind: 'named-export';
	readonly moduleSpecifier: string;
	readonly prefix: string;
	readonly replaceStart: number;
	readonly replaceEnd: number;
	readonly existingImports: ReadonlySet<string>;
	readonly typeOnly: boolean;
}

type JsImportCompletionContext = ModuleSpecifierContext | NamedExportContext;

export async function jsImportCompletionItems(
	projectRoot: string,
	text: string,
	offset: number,
	resolveExports: JsImportExportResolver = () => [],
): Promise<readonly CompletionItem[] | undefined> {
	const context = jsImportCompletionContext(text, offset);
	if (context === undefined) return undefined;
	if (context.kind === 'module') {
		const names = await declaredPackageNames(projectRoot);
		return names
			.filter(name => name.startsWith(context.prefix))
			.map(name => ({
				label: name,
				kind: CompletionItemKind.Module,
				detail: 'JavaScript package dependency',
				textEdit: { range: offsetRange(text, context.replaceStart, context.replaceEnd), newText: name },
			}));
	}
	const exports = await resolveExports(context.moduleSpecifier, context.typeOnly);
	return [...exports]
		.filter(item => item.name.startsWith(context.prefix) && !context.existingImports.has(item.name) && item.name !== 'default')
		.sort((left, right) => compareText(left.name, right.name))
		.map(item => ({
			label: item.name,
			kind: completionKind(item.kind),
			detail: `JavaScript export from ${context.moduleSpecifier}`,
			textEdit: { range: offsetRange(text, context.replaceStart, context.replaceEnd), newText: item.name },
		}));
}

function jsImportCompletionContext(text: string, offset: number): JsImportCompletionContext | undefined {
	const declaration = activeJsImportDeclaration(text, offset);
	if (declaration === undefined) return undefined;
	const cursor = offset - declaration.start;
	const segment = declaration.text;
	const quoteStart = segment.indexOf('"');
	if (quoteStart >= 0) {
		const quoteEnd = segment.indexOf('"', quoteStart + 1);
		if (cursor > quoteStart && (quoteEnd < 0 || cursor <= quoteEnd)) {
			const replaceStart = declaration.start + quoteStart + 1;
			const replaceEnd = declaration.start + (quoteEnd < 0 ? cursor : quoteEnd);
			return {
				kind: 'module',
				prefix: text.slice(replaceStart, offset),
				replaceStart,
				replaceEnd,
			};
		}
	}

	const openBrace = segment.indexOf('{');
	const closeBrace = openBrace < 0 ? -1 : segment.indexOf('}', openBrace + 1);
	if (openBrace < 0 || closeBrace < 0 || cursor <= openBrace || cursor > closeBrace) return undefined;
	const fromMatch = /\bfrom\s+"([^"]+)"/u.exec(segment.slice(closeBrace + 1));
	const moduleSpecifier = fromMatch?.[1];
	if (moduleSpecifier === undefined) return undefined;
	const currentItemStart = Math.max(openBrace, segment.lastIndexOf(',', cursor - 1)) + 1;
	if (/\bas(?:\s+[A-Za-z0-9_]*)?$/u.test(segment.slice(currentItemStart, cursor))) return undefined;

	let tokenStart = cursor;
	while (tokenStart > openBrace + 1 && isIdentifierCharacter(segment[tokenStart - 1]!)) tokenStart--;
	let tokenEnd = cursor;
	while (tokenEnd < closeBrace && isIdentifierCharacter(segment[tokenEnd]!)) tokenEnd++;
	const existingImports = new Set<string>();
	for (const item of segment.slice(openBrace + 1, closeBrace).split(',')) {
		const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)/u.exec(item);
		if (match?.[1] !== undefined) existingImports.add(match[1]);
	}
	const currentName = segment.slice(tokenStart, tokenEnd);
	if (currentName.length > 0) existingImports.delete(currentName);
	return {
		kind: 'named-export',
		moduleSpecifier,
		prefix: segment.slice(tokenStart, cursor),
		replaceStart: declaration.start + tokenStart,
		replaceEnd: declaration.start + tokenEnd,
		existingImports,
		typeOnly: /^\s*(?:pub\s+)?import\s+js\s+type\b/u.test(segment),
	};
}

function activeJsImportDeclaration(text: string, offset: number): { readonly start: number; readonly text: string } | undefined {
	const matcher = /^(?:[ \t]*)(?:pub[ \t]+)?import[ \t]+js\b/gmu;
	let start: number | undefined;
	for (const match of text.matchAll(matcher)) {
		if (match.index > offset) break;
		start = match.index;
	}
	if (start === undefined) return undefined;
	const end = importDeclarationEnd(text, start);
	if (offset < start || offset > end) return undefined;
	return { start, text: text.slice(start, end) };
}

function importDeclarationEnd(text: string, start: number): number {
	let braces = 0;
	let string = false;
	let escaped = false;
	for (let index = start; index < text.length; index++) {
		const character = text[index]!;
		if (string) {
			if (escaped) escaped = false;
			else if (character === '\\') escaped = true;
			else if (character === '"') string = false;
			continue;
		}
		if (character === '"') {
			string = true;
			continue;
		}
		if (character === '{') braces++;
		else if (character === '}') braces = Math.max(0, braces - 1);
		else if (character === '\n' && braces === 0) return index;
	}
	return text.length;
}

async function declaredPackageNames(projectRoot: string): Promise<readonly string[]> {
	try {
		const manifest = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8')) as Record<string, unknown>;
		const names = new Set<string>();
		for (const key of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
			const dependencies = manifest[key];
			if (dependencies === null || typeof dependencies !== 'object' || Array.isArray(dependencies)) continue;
			for (const name of Object.keys(dependencies)) names.add(name);
		}
		return [...names].sort(compareText);
	} catch {
		return [];
	}
}

function completionKind(kind: string): CompletionItemKind {
	switch (kind) {
		case 'function': return CompletionItemKind.Function;
		case 'method': return CompletionItemKind.Method;
		case 'class': return CompletionItemKind.Class;
		case 'interface': return CompletionItemKind.Interface;
		case 'enum': return CompletionItemKind.Enum;
		case 'const': return CompletionItemKind.Constant;
		case 'let':
		case 'var': return CompletionItemKind.Variable;
		case 'module': return CompletionItemKind.Module;
		case 'type': return CompletionItemKind.Class;
		default: return CompletionItemKind.Reference;
	}
}

function offsetRange(text: string, start: number, end: number): Range {
	return { start: offsetPosition(text, start), end: offsetPosition(text, end) };
}

function offsetPosition(text: string, offset: number): { readonly line: number; readonly character: number } {
	let line = 0;
	let lineStart = 0;
	for (let index = 0; index < Math.min(offset, text.length); index++) {
		if (text.charCodeAt(index) === 10) {
			line++;
			lineStart = index + 1;
		}
	}
	return { line, character: Math.max(0, offset - lineStart) };
}

function isIdentifierCharacter(character: string): boolean {
	return /[A-Za-z0-9_]/u.test(character);
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
