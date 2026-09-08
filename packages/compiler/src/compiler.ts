import type { IRecognitionException } from 'chevrotain';
import { buildAst } from './syntax/cst-to-ast.js';
import { attachDocumentation } from './syntax/documentation.js';
import { lex } from './syntax/tokens.js';
import { parse } from './syntax/parser.js';
import { checkModule, type SemanticModel } from './checker/checker.js';
import { lowerToHir } from './hir/lower.js';
import { emitJavaScript, type EmitResult } from './codegen/emitter.js';
import { DiagnosticBag, diagnosticCause, type Diagnostic } from './diagnostics/diagnostic.js';
import type { ModuleNode } from './ast/nodes.js';
import { validateFrontendJsxUsage } from './interop/jsx-view-validation.js';
import type { JsInteropProvider } from './interop/types.js';
import type { SourceFile, SourceSpan } from './source.js';

export interface CompileOptions {
	readonly outputFile?: string;
	readonly emit?: boolean;
	readonly sourceMap?: boolean;
	readonly sourcesContent?: boolean;
	readonly sourcePath?: string;
	readonly platform?: 'node' | 'browser' | 'neutral';
	readonly jsInteropProvider?: JsInteropProvider;
}

export interface CompileResult {
	readonly source: SourceFile;
	readonly diagnostics: readonly Diagnostic[];
	readonly ast?: ModuleNode;
	readonly semantic?: SemanticModel;
	readonly output?: EmitResult;
}

const frontendPrimitiveParameters = new Set(['Bool', 'Int', 'Float', 'BigInt', 'String']);

export function compileSource(source: SourceFile, options: CompileOptions = {}): CompileResult {
	const diagnostics = new DiagnosticBag();
	const lexResult = lex(source.text);
	for (const error of lexResult.errors) {
		const span: SourceSpan = {
			fileId: source.id,
			start: { offset: error.offset, line: error.line ?? 1, column: error.column ?? 1 },
			end: { offset: error.offset + error.length, line: error.line ?? 1, column: (error.column ?? 1) + error.length },
		};
		diagnostics.error('L0001', error.message, span);
	}
	const parseResult = parse(lexResult.tokens);
	for (const error of parseResult.errors) diagnostics.add(parserDiagnostic(source, error));
	if (diagnostics.hasErrors) return { source, diagnostics: diagnostics.items };
	let ast: ModuleNode;
	try { ast = attachDocumentation(buildAst(source.id, parseResult.cst), source, lexResult.comments, lexResult.tokens, diagnostics); }
	catch (error) {
		diagnostics.error('L9001', 'AST construction failed after parsing completed', {
			fileId: source.id, start: { offset: 0, line: 1, column: 1 }, end: { offset: 0, line: 1, column: 1 },
		}, {
			help: 'Report this diagnostic with the source file and compiler version.',
			cause: diagnosticCause(error),
		});
		return { source, diagnostics: diagnostics.items };
	}
	if (diagnostics.hasErrors) return { source, diagnostics: diagnostics.items, ast };
	const semantic = checkModule(ast, { ...(options.platform === undefined ? {} : { platform: options.platform }), containingFile: source.path, ...(options.jsInteropProvider === undefined ? {} : { jsInteropProvider: options.jsInteropProvider }) });
	validateFrontendJsxUsage(ast, semantic, { containingFile: source.path, platform: options.platform ?? 'neutral', ...(options.jsInteropProvider === undefined ? {} : { jsInteropProvider: options.jsInteropProvider }) });
	for (const diagnostic of semantic.diagnostics.items) diagnostics.add(diagnostic);
	if (diagnostics.hasErrors || options.emit === false) return { source, diagnostics: diagnostics.items, ast, semantic };
	const component = ast.declarations.find(declaration => declaration.kind === 'ComponentDeclaration');
	if (component !== undefined) {
		validateSingleFileComponentBoundary(ast, semantic, diagnostics);
		if (diagnostics.hasErrors) return { source, diagnostics: diagnostics.items, ast, semantic };
	}
	const hir = lowerToHir(ast, semantic);
	const outputFile = options.outputFile ?? source.path.replace(/\.virune$/u, component === undefined ? '.js' : '.jsx');
	const output = emitJavaScript(hir, source, outputFile, {
		...(options.sourceMap === undefined ? {} : { sourceMap: options.sourceMap }),
		...(options.sourcesContent === undefined ? {} : { sourcesContent: options.sourcesContent }),
		...(options.sourcePath === undefined ? {} : { sourcePath: options.sourcePath }),
	});
	return { source, diagnostics: diagnostics.items, ast, semantic, output };
}

function validateSingleFileComponentBoundary(module: ModuleNode, semantic: SemanticModel, diagnostics: DiagnosticBag): void {
	for (const declaration of module.declarations) {
		if (declaration.kind !== 'ComponentDeclaration') continue;
		const parameterNames = new Set(declaration.parameters.map(parameter => parameter.name));
		for (const parameter of declaration.parameters) {
			const symbol = parameter.symbolId === undefined ? undefined : semantic.symbols.get(parameter.symbolId);
			const type = symbol === undefined ? undefined : semantic.arena.get(symbol.typeId);
			if (type?.kind === 'primitive' && frontendPrimitiveParameters.has(type.name)) continue;
			const display = symbol === undefined ? '<unresolved>' : semantic.arena.display(symbol.typeId);
			diagnostics.error('L4309', `Component parameter ${parameter.name} has type ${display}; single-file JSX emission currently supports only Bool, Int, Float, BigInt, and String host props`, parameter.span);
		}
		const interpolation = findUnsupportedComponentInterpolation(declaration.body, parameterNames);
		if (interpolation?.kind === 'view-text') {
			diagnostics.error('L4309', 'Interpolated View text children are not available in single-file JSX emission; use an explicit View expression child instead', interpolation.span);
		} else if (interpolation !== undefined) {
			diagnostics.error('L4309', `Component parameter ${interpolation.name} cannot be referenced directly through string interpolation because component parameters remain host-backed at each use site; bind it to an explicit local value first`, interpolation.span);
		}
	}
}

function findUnsupportedComponentInterpolation(value: unknown, parameterNames: ReadonlySet<string>): { readonly kind: 'view-text'; readonly span: SourceSpan } | { readonly kind: 'host-parameter'; readonly name: string; readonly span: SourceSpan } | undefined {
	if (Array.isArray(value)) {
		for (const item of value) {
			const found = findUnsupportedComponentInterpolation(item, parameterNames);
			if (found !== undefined) return found;
		}
		return undefined;
	}
	if (value === null || typeof value !== 'object') return undefined;
	const node = value as Record<string, unknown>;
	if (node.kind === 'ViewTextChild' && typeof node.value === 'string' && /(?<!\{)\{[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*\}(?!\})/u.test(node.value)) {
		return { kind: 'view-text', span: node.span as SourceSpan };
	}
	if (node.kind === 'LiteralExpression' && node.literalKind === 'String' && typeof node.value === 'string') {
		for (const match of node.value.matchAll(/(?<!\{)\{([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\}(?!\})/gu)) {
			const path = match[1];
			if (path === undefined) continue;
			const name = path.split('.')[0]!;
			if (parameterNames.has(name)) return { kind: 'host-parameter', name, span: node.span as SourceSpan };
		}
	}
	for (const [key, child] of Object.entries(node)) {
		if (key === 'span') continue;
		const found = findUnsupportedComponentInterpolation(child, parameterNames);
		if (found !== undefined) return found;
	}
	return undefined;
}

function parserDiagnostic(source: SourceFile, error: IRecognitionException): Diagnostic {
	const token = error.token;
	const startOffset = finitePosition(token.startOffset, source.text.length, 0);
	const endOffset = Math.min(source.text.length, Math.max(startOffset, finitePosition(token.endOffset, startOffset, 0)));
	const startLine = finitePosition(token.startLine, lineAt(source.text, startOffset), 1);
	const startColumn = finitePosition(token.startColumn, columnAt(source.text, startOffset), 1);
	const endLine = finitePosition(token.endLine, startLine, 1);
	const endColumn = finitePosition(token.endColumn, startColumn, 1) + (endOffset === startOffset ? 0 : 1);
	return {
		code: 'L0002', severity: 'error', message: error.message,
		span: {
			fileId: source.id,
			start: { offset: startOffset, line: startLine, column: startColumn },
			end: { offset: endOffset, line: endLine, column: endColumn },
		},
	};
}

function finitePosition(value: number | undefined, fallback: number, minimum: number): number {
	return value !== undefined && Number.isFinite(value) && value >= minimum ? value : fallback;
}

function lineAt(text: string, offset: number): number {
	let line = 1;
	for (let index = 0; index < offset; index++) if (text[index] === '\n') line++;
	return line;
}

function columnAt(text: string, offset: number): number {
	return offset - text.lastIndexOf('\n', Math.max(0, offset - 1));
}
