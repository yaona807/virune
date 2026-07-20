import type { IRecognitionException } from 'chevrotain';
import { buildAst } from './syntax/cst-to-ast.js';
import { attachDocumentation } from './syntax/documentation.js';
import { lex } from './syntax/tokens.js';
import { parse } from './syntax/parser.js';
import { checkModule, type SemanticModel } from './checker/checker.js';
import { lowerToHir } from './hir/lower.js';
import { emitJavaScript, type EmitResult } from './codegen/emitter.js';
import { DiagnosticBag, type Diagnostic } from './diagnostics/diagnostic.js';
import type { ModuleNode } from './ast/nodes.js';
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
		diagnostics.error('L9001', `AST construction failed: ${error instanceof Error ? error.message : String(error)}`, {
			fileId: source.id, start: { offset: 0, line: 1, column: 1 }, end: { offset: 0, line: 1, column: 1 },
		});
		return { source, diagnostics: diagnostics.items };
	}
	if (diagnostics.hasErrors) return { source, diagnostics: diagnostics.items, ast };
	const semantic = checkModule(ast, { ...(options.platform === undefined ? {} : { platform: options.platform }), containingFile: source.path, ...(options.jsInteropProvider === undefined ? {} : { jsInteropProvider: options.jsInteropProvider }) });
	for (const diagnostic of semantic.diagnostics.items) diagnostics.add(diagnostic);
	if (diagnostics.hasErrors || options.emit === false) return { source, diagnostics: diagnostics.items, ast, semantic };
	const hir = lowerToHir(ast, semantic);
	const outputFile = options.outputFile ?? source.path.replace(/\.virune$/u, '.js');
	const output = emitJavaScript(hir, source, outputFile, {
		...(options.sourceMap === undefined ? {} : { sourceMap: options.sourceMap }),
		...(options.sourcesContent === undefined ? {} : { sourcesContent: options.sourcesContent }),
		...(options.sourcePath === undefined ? {} : { sourcePath: options.sourcePath }),
	});
	return { source, diagnostics: diagnostics.items, ast, semantic, output };
}

function parserDiagnostic(source: SourceFile, error: IRecognitionException): Diagnostic {
	const token = error.token;
	const startOffset = finitePosition(token.startOffset, source.text.length);
	const endOffset = Math.min(source.text.length, Math.max(startOffset, finitePosition(token.endOffset, startOffset)));
	const startLine = finitePosition(token.startLine, lineAt(source.text, startOffset));
	const startColumn = finitePosition(token.startColumn, columnAt(source.text, startOffset));
	const endLine = finitePosition(token.endLine, startLine);
	const endColumn = finitePosition(token.endColumn, startColumn) + (endOffset === startOffset ? 0 : 1);
	return {
		code: 'L0002', severity: 'error', message: error.message,
		span: {
			fileId: source.id,
			start: { offset: startOffset, line: startLine, column: startColumn },
			end: { offset: endOffset, line: endLine, column: endColumn },
		},
	};
}

function finitePosition(value: number | undefined, fallback: number): number {
	return value !== undefined && Number.isFinite(value) ? value : fallback;
}

function lineAt(text: string, offset: number): number {
	let line = 1;
	for (let index = 0; index < offset; index++) if (text[index] === '\n') line++;
	return line;
}

function columnAt(text: string, offset: number): number {
	return offset - text.lastIndexOf('\n', Math.max(0, offset - 1));
}
