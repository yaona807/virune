import type * as A from '../ast/nodes.js';
import type { SemanticModel } from '../checker/checker.js';
import type { HirModule } from '../hir/lower.js';
import type { SourceFile, SymbolId, TypeId } from '../source.js';
import { escapeTemplate, panicEmitter, safeName } from './helpers.js';
import { runtimeImportLines } from './runtime-imports.js';
import { SourceWriter } from './writer.js';

export interface EmitResult { readonly code: string; readonly map: string; }
export interface EmitOptions { readonly sourceMap?: boolean; readonly sourcesContent?: boolean; readonly sourcePath?: string; }



export class JavaScriptEmitter {
	readonly #writer: SourceWriter;
	readonly #semantic: SemanticModel;
	readonly #source: SourceFile;
	readonly #symbolNames = new Map<SymbolId, string>();
	readonly #sourceMap: boolean;
	#contextName = '$ctx';
	#temporary = 0;
	#currentAsync = false;
	readonly #deferStacks: string[] = [];

	public constructor(hir: HirModule, source: SourceFile, outputFile: string, options: EmitOptions = {}) {
		this.#semantic = hir.semantic;
		this.#source = source;
		this.#sourceMap = options.sourceMap ?? true;
		this.#writer = new SourceWriter(source, outputFile, options.sourcePath ?? source.path, options.sourcesContent ?? true);
		for (const [id, symbol] of hir.semantic.symbols) this.#symbolNames.set(id, safeName(symbol.name));
	}

	public emit(module: A.ModuleNode): EmitResult {
		this.#moduleDeclarations = module.declarations;
		for (const declaration of module.declarations) {
			if (declaration.kind === 'FunctionDeclaration' && declaration.symbolId !== undefined && declaration.attributes.some(item => item.name === 'jsExport')) this.#symbolNames.set(declaration.symbolId, `$impl_${safeName(declaration.name)}`);
		}
		this.emitHeader(module);
		for (const declaration of module.imports) this.emitImport(declaration);
		this.emitExternImports(module.declarations);
		if (module.imports.length > 0 || module.declarations.some(item => item.kind === 'ExternDeclaration')) this.#writer.line();
		for (const declaration of module.declarations) {
			this.emitDeclaration(declaration);
			this.#writer.line();
		}
		const result = this.#writer.result();
		return { code: this.#sourceMap ? `${result.code}//# sourceMappingURL=${this.outputMapName()}\n` : result.code, map: result.map };
	}

	private emitHeader(module: A.ModuleNode): void {
		for (const line of runtimeImportLines(module)) this.#writer.line(line);
	}

	private outputMapName(): string { return `${this.#source.path.split(/[\\/]/u).at(-1)?.replace(/\.virune$/u, '.js') ?? 'module.js'}.map`; }

	private emitImport(declaration: A.ImportDeclaration): void {
		if (declaration.typeOnly) return;
		const source = declaration.sourceKind === 'virune' && declaration.source.endsWith('.virune')
			? declaration.source.slice(0, -7) + '.js'
			: declaration.sourceKind === 'javascript' && declaration.source.endsWith('.interop.ts')
				? declaration.source.slice(0, -3) + '.mjs'
				: declaration.source;
		this.#writer.mark(declaration.span);
		if (declaration.defaultImport !== undefined) {
			this.#writer.line(`import ${safeName(declaration.defaultImport)} from ${JSON.stringify(source)};`);
			if (declaration.public) this.#writer.line(`export { ${safeName(declaration.defaultImport)} };`);
			return;
		}
		if (declaration.namespaceImport !== undefined) {
			this.#writer.line(`import * as ${safeName(declaration.namespaceImport)} from ${JSON.stringify(source)};`);
			if (declaration.public) this.#writer.line(`export { ${safeName(declaration.namespaceImport)} };`);
			return;
		}
		if (declaration.items.length === 0) { this.#writer.line(`import ${JSON.stringify(source)};`); return; }
		const items = declaration.items.map(item => item.imported === item.local ? item.imported : `${item.imported} as ${safeName(item.local)}`).join(', ');
		this.#writer.line(`import { ${items} } from ${JSON.stringify(source)};`);
		if (declaration.public) this.#writer.line(`export { ${declaration.items.map(item => safeName(item.local)).join(', ')} };`);
	}

	private emitExternImports(declarations: readonly A.Declaration[]): void {
		let index = 0;
		for (const declaration of declarations) {
			if (declaration.kind !== 'ExternDeclaration') continue;
			this.#writer.line(`import * as $ffi${index} from ${JSON.stringify(declaration.module)};`);
			index++;
		}
	}

	private emitDeclaration(declaration: A.Declaration): void {
		this.#writer.mark(declaration.span, 'name' in declaration ? declaration.name : undefined);
		switch (declaration.kind) {
			case 'FunctionDeclaration': this.emitFunction(declaration); break;
			case 'RecordDeclaration': this.emitRecordDeclaration(declaration); break;
			case 'EnumDeclaration': this.emitEnumDeclaration(declaration); break;
			case 'NewtypeDeclaration': this.emitNewtypeDeclaration(declaration); break;
			case 'TypeAliasDeclaration': this.#writer.line(`// type ${declaration.name} is erased during JavaScript emission.`); break;
			case 'ExternDeclaration': this.emitExternDeclaration(declaration); break;
			case 'TestDeclaration': this.emitTest(declaration); break;
			case 'TopLevelLetDeclaration': this.#writer.line(`${declaration.public ? 'export ' : this.exportPrefix(declaration.attributes)}const ${this.nameOf(declaration.symbolId, declaration.name)} = ${this.expression(declaration.value)};`); break;
		}
	}

	private emitRecordDeclaration(declaration: A.RecordDeclaration): void {
		this.#writer.line(`// record ${declaration.name}`);
		if (declaration.public) this.#writer.line(`export const ${safeName(declaration.name)} = Object.freeze({ name: ${JSON.stringify(declaration.name)}, typeId: ${JSON.stringify(this.declarationTypeId(declaration.symbolId, declaration.definitionId ?? declaration.name))} });`);
	}

	private emitEnumDeclaration(declaration: A.EnumDeclaration): void {
		this.#writer.line(`// enum ${declaration.name}`);
		for (const variant of declaration.variants) {
			const prefix = declaration.public ? 'export ' : '';
			const name = this.nameOf(variant.symbolId, variant.name);
			if (variant.values.length === 0) this.#writer.line(`${prefix}const ${name} = Object.freeze(makeVariant(${JSON.stringify(variant.name)}, [], ${JSON.stringify(this.declarationTypeId(declaration.symbolId, declaration.definitionId ?? declaration.name))}));`);
			else {
				const args = variant.values.map((_, index) => `$value${index}`).join(', ');
				this.#writer.line(`${prefix}function ${name}(${args}) { return makeVariant(${JSON.stringify(variant.name)}, [${args}], ${JSON.stringify(this.declarationTypeId(declaration.symbolId, declaration.definitionId ?? declaration.name))}); }`);
			}
		}
		this.#writer.line(`${declaration.public ? 'export ' : ''}const ${safeName(declaration.name)} = Object.freeze({ ${declaration.variants.map(variant => safeName(variant.name)).join(', ')} });`);
	}

	private emitNewtypeDeclaration(declaration: A.NewtypeDeclaration): void {
		const prefix = declaration.public ? 'export ' : '';
		this.#writer.line(`${prefix}const ${safeName(declaration.name)} = Object.freeze({ create: value => value });`);
	}

	private emitFunction(declaration: A.FunctionDeclaration): void {
		const jsExport = declaration.attributes.some(item => item.name === 'jsExport');
		const prefix = declaration.public && !jsExport ? 'export ' : '';
		const asyncKeyword = declaration.async ? 'async ' : '';
		const name = this.nameOf(declaration.symbolId, declaration.name);
		const parameters = declaration.parameters.map(parameter => this.nameOf(parameter.symbolId, parameter.name));
		parameters.push('$ctx = rootTaskContext()');
		this.#writer.line(`${prefix}${asyncKeyword}function ${name}(${parameters.join(', ')}) {`);
		const previousAsync = this.#currentAsync;
		const previousContextName = this.#contextName;
		this.#currentAsync = declaration.async;
		this.#contextName = '$ctx';
		this.#writer.indent(() => {
			this.#writer.line('try {');
			this.#writer.indent(() => {
				if (declaration.expressionBody) this.#writer.line(`return ${this.expression(declaration.body as A.Expression)};`);
				else this.emitBlock(declaration.body as A.BlockStatement);
			});
			this.#writer.line('} catch ($error) {');
			this.#writer.indent(() => {
				this.#writer.line('if (isPropagation($error)) return $error.value;');
				this.#writer.line('throw $error;');
			});
			this.#writer.line('}');
		});
		this.#writer.line('}');
		this.#currentAsync = previousAsync;
		this.#contextName = previousContextName;
		if (jsExport) this.emitJsExportWrapper(declaration, name);
	}

	private emitJsExportWrapper(declaration: A.FunctionDeclaration, implementationName: string): void {
		const rawParameters = declaration.parameters.map(parameter => `$js_${safeName(parameter.name)}`);
		this.#writer.line(`export ${declaration.async ? 'async ' : ''}function ${safeName(declaration.name)}(${rawParameters.join(', ')}) {`);
		this.#writer.indent(() => {
			const validated = declaration.parameters.map((parameter, index) => {
				const local = `$arg_${safeName(parameter.name)}`;
				this.#writer.line(`const ${local} = validateFfiValue(${rawParameters[index]}, ${this.typeDescriptor(parameter.type)}, ${JSON.stringify(`$.${parameter.name}`)});`);
				return local;
			});
			const call = `${implementationName}(${[...validated, 'rootTaskContext()'].join(', ')})`;
			this.#writer.line(`return encodeFfiValue(${declaration.async ? `await ${call}` : call}, ${this.typeDescriptor(declaration.returnType)});`);
		});
		this.#writer.line('}');
	}

	private emitExternDeclaration(declaration: A.ExternDeclaration): void {
		const externIndex = this.externIndex(declaration);
		for (const fn of declaration.functions) {
			const name = this.nameOf(fn.symbolId, fn.name);
			const args = fn.parameters.map(parameter => this.nameOf(parameter.symbolId, parameter.name));
			if (fn.async) args.push('$ctx = rootTaskContext()');
			const encoded = fn.parameters.map(parameter => `encodeFfiValue(${this.nameOf(parameter.symbolId, parameter.name)}, ${this.typeDescriptor(parameter.type)})`);
			const optionalCount = [...fn.parameters].reverse().findIndex(parameter => !parameter.optional);
			const trailingOptional = optionalCount < 0 ? fn.parameters.length : optionalCount;
			const invocation = (body: string): string => {
				if (trailingOptional === 0) return body.replace('$ARGS', encoded.join(', '));
				const requiredCount = fn.parameters.length - trailingOptional;
				return `{ const $args = [${encoded.join(', ')}]; while ($args.length > ${requiredCount} && $args[$args.length - 1] === undefined) $args.pop(); ${body.replace('$ARGS', '...$args')} }`;
			};
			const rawCall = `$ffi${externIndex}[${JSON.stringify(fn.jsName)}]($ARGS)`;
			if (declaration.unsafe) this.#writer.line(`${fn.async ? 'async ' : ''}function ${name}(${args.join(', ')}) ${invocation(`{ return ${rawCall}; }`)}`);
			else if (fn.async) { const success = fn.returnType.name === 'Result' ? fn.returnType.arguments[0] : undefined; this.#writer.line(`async function ${name}(${args.join(', ')}) ${invocation(`{ return safeCallAsync(async () => validateFfiValue(await ${rawCall}, ${this.typeDescriptor(success)}, '$')); }`)}`); }
			else { const success = fn.returnType.name === 'Result' ? fn.returnType.arguments[0] : undefined; this.#writer.line(`function ${name}(${args.join(', ')}) ${invocation(`{ return safeCall(() => validateFfiValue(${rawCall}, ${this.typeDescriptor(success)}, '$')); }`)}`); }
		}
	}

	private externIndex(target: A.ExternDeclaration): number {
		let index = 0;
		for (const declaration of this.currentModuleDeclarations()) {
			if (declaration === target) return index;
			if (declaration.kind === 'ExternDeclaration') index++;
		}
		return index;
	}
	#moduleDeclarations: readonly A.Declaration[] = [];
	private currentModuleDeclarations(): readonly A.Declaration[] { return this.#moduleDeclarations; }

	private emitTest(declaration: A.TestDeclaration): void {
		this.#writer.line(`test(${JSON.stringify(declaration.name)}, ${declaration.async ? 'async ' : ''}() => {`);
		const previousAsync = this.#currentAsync; this.#currentAsync = declaration.async;
		this.#writer.indent(() => {
			this.#writer.line('const $ctx = rootTaskContext();');
			this.emitBlock(declaration.body);
		});
		this.#currentAsync = previousAsync;
		this.#writer.line('});');
	}

	private emitBlock(block: A.BlockStatement): void {
		const hasDefer = block.statements.some(statement => statement.kind === 'DeferStatement');
		if (!hasDefer) { for (const statement of block.statements) this.emitStatement(statement); return; }
		const stack = `$defers${this.#temporary++}`;
		const primary = `$primary${this.#temporary++}`;
		this.#writer.line(`const ${stack} = [];`);
		this.#writer.line(`let ${primary};`);
		this.#writer.line('try {');
		this.#deferStacks.push(stack);
		this.#writer.indent(() => { for (const statement of block.statements) this.emitStatement(statement); });
		this.#deferStacks.pop();
		this.#writer.line('} catch ($error) {');
		this.#writer.indent(() => { this.#writer.line(`${primary} = $error;`); this.#writer.line('throw $error;'); });
		this.#writer.line('} finally {');
		this.#writer.indent(() => this.#writer.line(`${this.#currentAsync ? 'await runDefersAsync' : 'runDefers'}(${stack}, ${primary});`));
		this.#writer.line('}');
	}

	private emitStatement(statement: A.Statement): void {
		this.#writer.mark(statement.span);
		switch (statement.kind) {
			case 'LetStatement': this.#writer.line(`${statement.mutable ? 'let' : 'const'} ${this.nameOf(statement.symbolId, statement.name)} = ${this.expression(statement.value)};`); break;
			case 'ReturnStatement': this.#writer.line(statement.value === undefined ? 'return undefined;' : `return ${this.expression(statement.value)};`); break;
			case 'IfStatement': this.emitIf(statement); break;
			case 'ForStatement': {
				this.#writer.line(`for (const ${this.nameOf(statement.symbolId, statement.name)} of ${this.expression(statement.iterable)}) {`);
				this.#writer.indent(() => this.emitBlock(statement.body)); this.#writer.line('}'); break;
			}
			case 'WhileStatement': this.#writer.line(`while (${this.expression(statement.condition)}) {`); this.#writer.indent(() => this.emitBlock(statement.body)); this.#writer.line('}'); break;
			case 'AssignmentStatement': this.#writer.line(`${this.nameOf(statement.targetSymbolId, statement.name)} = ${this.expression(statement.value)};`); break;
			case 'DeferStatement': { const stack = this.#deferStacks.at(-1); if (stack === undefined) throw new Error('defer emitted outside deferred block'); this.#writer.line(`${stack}.push(${this.#currentAsync ? 'async ' : ''}() => ${this.expression(statement.expression)});`); break; }
			case 'BreakStatement': this.#writer.line('break;'); break;
			case 'ContinueStatement': this.#writer.line('continue;'); break;
			case 'DiscardStatement': this.#writer.line(`void ${this.expression(statement.expression)};`); break;
			case 'ExpressionStatement': this.#writer.line(`${this.expression(statement.expression)};`); break;
		}
	}

	private emitIf(statement: A.IfStatement): void {
		this.#writer.line(`if (${this.expression(statement.condition)}) {`); this.#writer.indent(() => this.emitBlock(statement.thenBlock));
		if (statement.elseBranch === undefined) this.#writer.line('}');
		else if (statement.elseBranch.kind === 'BlockStatement') { this.#writer.line('} else {'); this.#writer.indent(() => this.emitBlock(statement.elseBranch as A.BlockStatement)); this.#writer.line('}'); }
		else { this.#writer.line('} else {'); this.#writer.indent(() => this.emitIf(statement.elseBranch as A.IfStatement)); this.#writer.line('}'); }
	}

	private expression(expression: A.Expression, contextName = this.#contextName): string {
		const raw = this.expressionRaw(expression, contextName);
		switch (expression.foreignBridge) {
			case 'string': return `checkForeignString(${raw})`;
			case 'bool': return `checkForeignBool(${raw})`;
			case 'float': return `checkForeignFloat(${raw})`;
			case 'bigint': return `checkForeignBigInt(${raw})`;
			case 'unit': return `(${raw}, undefined)`;
			default: return raw;
		}
	}

	private expressionRaw(expression: A.Expression, contextName = this.#contextName): string {
		switch (expression.kind) {
			case 'LiteralExpression': return this.literal(expression);
			case 'IdentifierExpression': return this.identifier(expression);
			case 'WildcardExpression': return 'undefined';
			case 'CallExpression': return this.call(expression, contextName);
			case 'FieldExpression': return this.field(expression, contextName);
			case 'BinaryExpression': return this.binary(expression, contextName);
			case 'UnaryExpression': return expression.operator === '-' && expression.inferredTypeId === this.#semantic.arena.int ? `intNegate(${this.expression(expression.operand, contextName)})` : `(${expression.operator}${this.expression(expression.operand, contextName)})`;
			case 'PipelineExpression': return panicEmitter('PipelineExpression should be lowered before emission');
			case 'TryExpression': return `propagate(${this.expression(expression.operand, contextName)})`;
			case 'AwaitExpression': return `(await ${this.expression(expression.operand, contextName)})`;
			case 'RecordExpression': { const type = expression.inferredTypeId === undefined ? undefined : this.#semantic.arena.get(expression.inferredTypeId); const typeId = type?.kind === 'named' ? type.definitionId : expression.name; return `makeRecord({ ${expression.entries.map(entry => `${safeName(entry.name)}: ${this.expression(entry.value, contextName)}`).join(', ')} }, ${JSON.stringify(typeId)})`; }
			case 'RecordUpdateExpression': return `updateRecord(${this.expression(expression.base, contextName)}, { ${expression.entries.map(entry => `${safeName(entry.name)}: ${this.expression(entry.value, contextName)}`).join(', ')} })`;
			case 'ListExpression': return `[${expression.items.map(item => this.expression(item, contextName)).join(', ')}]`;
			case 'TupleExpression': return `[${expression.items.map(item => this.expression(item, contextName)).join(', ')}]`;
			case 'ConditionalExpression': return `(${this.expression(expression.condition, contextName)} ? ${this.expression(expression.thenExpression, contextName)} : ${this.expression(expression.elseExpression, contextName)})`;
			case 'MatchExpression': return this.match(expression, contextName);
			case 'LambdaExpression': return this.lambdaExpression(expression, contextName);
			case 'ParallelExpression': return this.parallelExpression(expression, contextName);
		}
	}

	private lambdaExpression(expression: A.LambdaExpression, outerContextName: string): string {
		const parameters = expression.parameters.map(parameter => this.nameOf(parameter.symbolId, parameter.name));
		const contextName = expression.async ? `$lambdaCtx${this.#temporary++}` : outerContextName;
		if (expression.async) parameters.push(`${contextName} = rootTaskContext()`);
		const lines: string[] = [`${expression.async ? 'async ' : ''}(${parameters.join(', ')}) => {`, '\ttry {'];
		if (expression.expressionBody) lines.push(`\t\treturn ${this.expression(expression.body as A.Expression, contextName)};`);
		else lines.push(...this.inlineBlock(expression.body as A.BlockStatement, contextName, expression.async, 2));
		lines.push('\t} catch ($error) {', '\t\tif (isPropagation($error)) return $error.value;', '\t\tthrow $error;', '\t}', '}');
		return `(${lines.join('\n')})`;
	}

	private inlineBlock(block: A.BlockStatement, contextName: string, async: boolean, indent: number): string[] {
		const prefix = '\t'.repeat(indent);
		const hasDefer = block.statements.some(statement => statement.kind === 'DeferStatement');
		if (!hasDefer) return block.statements.flatMap(statement => this.inlineStatement(statement, contextName, async, indent));
		const stack = `$lambdaDefers${this.#temporary++}`;
		const primary = `$lambdaPrimary${this.#temporary++}`;
		const lines = [`${prefix}const ${stack} = [];`, `${prefix}let ${primary};`, `${prefix}try {`];
		for (const statement of block.statements) lines.push(...this.inlineStatement(statement, contextName, async, indent + 1, stack));
		lines.push(`${prefix}} catch ($error) {`, `${prefix}\t${primary} = $error;`, `${prefix}\tthrow $error;`, `${prefix}} finally {`, `${prefix}\t${async ? 'await runDefersAsync' : 'runDefers'}(${stack}, ${primary});`, `${prefix}}`);
		return lines;
	}

	private inlineStatement(statement: A.Statement, contextName: string, async: boolean, indent: number, deferStack?: string): string[] {
		const prefix = '\t'.repeat(indent);
		switch (statement.kind) {
			case 'LetStatement': return [`${prefix}${statement.mutable ? 'let' : 'const'} ${this.nameOf(statement.symbolId, statement.name)} = ${this.expression(statement.value, contextName)};`];
			case 'ReturnStatement': return [`${prefix}${statement.value === undefined ? 'return undefined;' : `return ${this.expression(statement.value, contextName)};`}`];
			case 'AssignmentStatement': return [`${prefix}${this.nameOf(statement.targetSymbolId, statement.name)} = ${this.expression(statement.value, contextName)};`];
			case 'BreakStatement': return [`${prefix}break;`];
			case 'ContinueStatement': return [`${prefix}continue;`];
			case 'DiscardStatement': return [`${prefix}void ${this.expression(statement.expression, contextName)};`];
			case 'ExpressionStatement': return [`${prefix}${this.expression(statement.expression, contextName)};`];
			case 'DeferStatement': {
				if (deferStack === undefined) throw new Error('defer emitted without an inline defer stack');
				return [`${prefix}${deferStack}.push(${async ? 'async ' : ''}() => ${this.expression(statement.expression, contextName)});`];
			}
			case 'WhileStatement': return [`${prefix}while (${this.expression(statement.condition, contextName)}) {`, ...this.inlineBlock(statement.body, contextName, async, indent + 1), `${prefix}}`];
			case 'ForStatement': return [`${prefix}for (const ${this.nameOf(statement.symbolId, statement.name)} of ${this.expression(statement.iterable, contextName)}) {`, ...this.inlineBlock(statement.body, contextName, async, indent + 1), `${prefix}}`];
			case 'IfStatement': return this.inlineIf(statement, contextName, async, indent);
		}
	}

	private inlineIf(statement: A.IfStatement, contextName: string, async: boolean, indent: number): string[] {
		const prefix = '\t'.repeat(indent);
		const lines = [`${prefix}if (${this.expression(statement.condition, contextName)}) {`, ...this.inlineBlock(statement.thenBlock, contextName, async, indent + 1)];
		if (statement.elseBranch === undefined) return [...lines, `${prefix}}`];
		if (statement.elseBranch.kind === 'BlockStatement') return [...lines, `${prefix}} else {`, ...this.inlineBlock(statement.elseBranch, contextName, async, indent + 1), `${prefix}}`];
		return [...lines, `${prefix}} else {`, ...this.inlineIf(statement.elseBranch, contextName, async, indent + 1), `${prefix}}`];
	}

	private literal(expression: A.LiteralExpression): string {
		if (expression.literalKind === 'String') return this.interpolatedString(expression.value as string);
		if (expression.literalKind === 'BigInt') return `${String(expression.value)}n`;
		return JSON.stringify(expression.value);
	}

	private interpolatedString(value: string): string {
		const placeholder = /(?<!\{)\{([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\}(?!\})/gu;
		if (!placeholder.test(value)) return JSON.stringify(value.replaceAll('{{', '{').replaceAll('}}', '}'));
		placeholder.lastIndex = 0;
		let result = '`'; let cursor = 0;
		for (const match of value.matchAll(placeholder)) {
			result += escapeTemplate(value.slice(cursor, match.index).replaceAll('{{', '{').replaceAll('}}', '}'));
			result += `\${${match[1]}}`; cursor = (match.index ?? 0) + match[0].length;
		}
		result += `${escapeTemplate(value.slice(cursor).replaceAll('{{', '{').replaceAll('}}', '}'))}\``;
		return result;
	}

	private identifier(expression: A.IdentifierExpression): string {
		if (expression.name === 'Unit') return 'undefined';
		if (expression.name === 'expect') return '$viruneExpect';
		if (['Some', 'None', 'Ok', 'Err', 'panic'].includes(expression.name)) return expression.name;
		return this.nameOf(expression.symbolId, expression.name);
	}

	private call(expression: A.CallExpression, contextName: string): string {
		const args = expression.arguments.map(argument => this.expression(argument, contextName));
		if (expression.callee.kind === 'FieldExpression' && expression.callee.target.kind === 'IdentifierExpression' && expression.callee.target.name === 'Json') {
			if (expression.callee.field === 'parse') return `parseJson(${args[0] ?? '""'})`;
			if (expression.callee.field === 'decode') {
				const result = expression.inferredTypeId === undefined ? undefined : this.#semantic.arena.get(expression.inferredTypeId);
				const target = result?.kind === 'result' ? result.value : this.#semantic.arena.unknown;
				return `decodeJsonValue(${args[0] ?? 'undefined'}, ${this.typeDescriptorFromTypeId(target)})`;
			}
			if (expression.callee.field === 'encode') {
				const target = expression.arguments[0]?.inferredTypeId ?? this.#semantic.arena.unknown;
				return `encodeJsonValue(${args[0] ?? 'undefined'}, ${this.typeDescriptorFromTypeId(target)})`;
			}
		}
		const callee = this.expression(expression.callee, contextName);
		if (expression.foreignCall !== true && this.acceptsTaskContext(expression.callee)) args.push(contextName);
		if (callee === '$viruneExpect') return `(${args[0] ?? 'false'} ? undefined : panic('Expectation failed'))`;
		return `${callee}(${args.join(', ')})`;
	}

	private field(expression: A.FieldExpression, contextName: string): string {
		if (expression.target.kind === 'IdentifierExpression') {
			const key = `${expression.target.name}.${expression.field}`;
			const mapped: Record<string, string> = {
				'Console.print': 'console.log', 'Int.toFloat': 'Number', 'Float.toInt': 'floatToInt',
				'Duration.milliseconds': 'durationMilliseconds', 'Duration.seconds': 'durationSeconds', 'Duration.minutes': 'durationMinutes', 'Duration.hours': 'durationHours', 'Duration.toMilliseconds': 'durationToMilliseconds',
				'List.length': 'listLength', 'List.isEmpty': 'listIsEmpty', 'List.isNotEmpty': 'listIsNotEmpty', 'List.first': 'listFirst', 'List.last': 'listLast', 'List.get': 'listGet',
				'List.append': 'listAppend', 'List.prepend': 'listPrepend', 'List.concat': 'listConcat', 'List.take': 'listTake', 'List.drop': 'listDrop', 'List.reverse': 'listReverse',
				'List.map': 'listMap', 'List.flatMap': 'listFlatMap', 'List.filter': 'listFilter', 'List.find': 'listFind', 'List.any': 'listAny', 'List.all': 'listAll', 'List.fold': 'listFold', 'List.zip': 'listZip', 'List.enumerate': 'listEnumerate', 'List.unique': 'listUnique', 'List.uniqueBy': 'listUniqueBy',
				'Map.empty': 'mapEmpty', 'Map.get': 'mapGet', 'Map.set': 'mapSet', 'Map.has': 'mapHas', 'Map.remove': 'mapRemove', 'Map.size': 'mapSize', 'Map.keys': 'mapKeys', 'Map.values': 'mapValues', 'Map.entries': 'mapEntries', 'Map.merge': 'mapMerge', 'Map.mapValues': 'mapMapValues',
				'Set.empty': 'setEmpty', 'Set.from': 'setFrom', 'Set.add': 'setAdd', 'Set.has': 'setHas', 'Set.remove': 'setRemove', 'Set.size': 'setSize', 'Set.toList': 'setToList', 'Set.union': 'setUnion', 'Set.intersection': 'setIntersection', 'Set.difference': 'setDifference',
				'Queue.empty': 'queueEmpty', 'Queue.enqueue': 'queueEnqueue', 'Queue.dequeue': 'queueDequeue', 'Stack.empty': 'stackEmpty', 'Stack.push': 'stackPush', 'Stack.pop': 'stackPop',
				'String.codePoints': 'stringCodePoints', 'String.graphemes': 'stringGraphemes', 'String.graphemeLength': 'stringGraphemeLength', 'String.normalizeNfc': 'stringNormalizeNfc', 'String.normalizeNfd': 'stringNormalizeNfd', 'String.normalizeNfkc': 'stringNormalizeNfkc', 'String.normalizeNfkd': 'stringNormalizeNfkd', 'String.length': 'stringLength', 'String.trim': 'stringTrim', 'String.trimStart': 'stringTrimStart', 'String.trimEnd': 'stringTrimEnd', 'String.contains': 'stringContains', 'String.startsWith': 'stringStartsWith', 'String.endsWith': 'stringEndsWith', 'String.toLowerCase': 'stringToLowerCase', 'String.toUpperCase': 'stringToUpperCase', 'String.split': 'stringSplit', 'String.slice': 'stringSlice', 'String.join': 'stringJoin', 'String.replace': 'stringReplace', 'String.at': 'stringAt', 'String.isEmpty': 'stringIsEmpty', 'String.isNotEmpty': 'stringIsNotEmpty',
				'ByteOrder.BigEndian': JSON.stringify('BigEndian'), 'ByteOrder.LittleEndian': JSON.stringify('LittleEndian'), 'HttpBody.Empty': "makeVariant('Empty', [], 'std:HttpBody')", 'HttpBody.Text': "(value => makeVariant('Text', [value], 'std:HttpBody'))", 'HttpBody.Bytes': "(value => makeVariant('Bytes', [value], 'std:HttpBody'))", 'Bytes.empty': 'bytesEmpty', 'Bytes.length': 'bytesLength', 'Bytes.fromUtf8': 'bytesFromUtf8', 'Bytes.toUtf8': 'bytesToUtf8', 'Bytes.fromHex': 'bytesFromHex', 'Bytes.toHex': 'bytesToHex', 'Bytes.fromBase64': 'bytesFromBase64', 'Bytes.toBase64': 'bytesToBase64', 'Bytes.concat': 'bytesConcat', 'Bytes.slice': 'bytesSlice', 'Bytes.get': 'bytesGet', 'Bytes.set': 'bytesSet', 'Bytes.readInt32': 'bytesReadInt32', 'Bytes.writeInt32': 'bytesWriteInt32', 'MutableBytes.create': 'mutableBytesCreate', 'MutableBytes.fromBytes': 'mutableBytesFromBytes', 'MutableBytes.toBytes': 'mutableBytesToBytes', 'MutableBytes.length': 'mutableBytesLength', 'MutableBytes.get': 'mutableBytesGet', 'MutableBytes.set': 'mutableBytesSet', 'MutableBytes.fill': 'mutableBytesFill', 'Byte.fromInt': 'byteCreate', 'Int8.fromInt': 'int8Create', 'Int8.toInt': 'int8ToInt', 'UInt8.fromInt': 'uint8Create', 'UInt8.toInt': 'uint8ToInt', 'Int16.fromInt': 'int16Create', 'Int16.toInt': 'int16ToInt', 'UInt16.fromInt': 'uint16Create', 'UInt16.toInt': 'uint16ToInt', 'Int32.fromInt': 'int32Create', 'Int32.toInt': 'int32ToInt', 'UInt32.fromInt': 'uint32Create', 'UInt32.toInt': 'uint32ToInt', 'Int64.fromBigInt': 'int64Create', 'Int64.toBigInt': 'int64ToBigInt', 'UInt64.fromBigInt': 'uint64Create', 'UInt64.toBigInt': 'uint64ToBigInt',
				'Debug.format': 'debugValue',
				'Option.map': 'optionMap', 'Option.andThen': 'optionAndThen', 'Option.filter': 'optionFilter', 'Option.unwrapOr': 'optionUnwrapOr', 'Option.toResult': 'optionToResult', 'Option.collect': 'optionCollect',
				'Result.map': 'resultMap', 'Result.mapError': 'resultMapError', 'Result.andThen': 'resultAndThen', 'Result.orElse': 'resultOrElse', 'Result.unwrapOr': 'resultUnwrapOr', 'Result.toOption': 'resultToOption', 'Result.collect': 'resultCollect', 'Result.collectErrors': 'resultCollectErrors',
				'Validation.valid': 'valid', 'Validation.invalid': 'invalid', 'Validation.map': 'validationMap', 'Validation.andThen': 'validationAndThen', 'Validation.collect': 'validationCollect',
				'Task.sleep': 'taskSleepBuiltin', 'Task.timeout': 'taskTimeoutBuiltin', 'Task.race': 'taskRaceBuiltin', 'Task.firstOk': 'taskFirstOkBuiltin', 'Task.retry': 'taskRetryBuiltin', 'Task.mapParallel': 'taskMapParallelBuiltin', 'Task.supervise': 'taskSuperviseBuiltin',
				'Stream.fromList': 'streamFromList', 'Stream.map': 'streamMap', 'Stream.filter': 'streamFilter', 'Stream.collect': 'streamCollect', 'Stream.take': 'streamTake',
				'File.readText': '$fileReadText', 'File.writeText': '$fileWriteText', 'File.readBytes': '$fileReadBytes', 'File.writeBytes': '$fileWriteBytes', 'File.open': '$fileOpen', 'File.read': '$fileRead', 'File.readHandleBytes': '$fileReadHandleBytes', 'File.write': '$fileWrite', 'File.writeHandleBytes': '$fileWriteHandleBytes', 'File.close': '$fileClose',
				'Path.join': '$pathJoin', 'Path.resolve': '$pathResolve', 'Path.dirname': '$pathDirname', 'Path.basename': '$pathBasename', 'Path.extname': '$pathExtname', 'Path.normalize': '$pathNormalize', 'Path.relative': '$pathRelative', 'Path.isAbsolute': '$pathIsAbsolute',
				'Process.args': '$processArgs', 'Process.cwd': '$processCwd', 'Process.exitCode': '$processExitCode', 'Process.environment': '$processEnvironment', 'Process.platform': '$processPlatform', 'Process.architecture': '$processArchitecture',
				'Http.get': '$httpGet', 'Http.request': '$httpRequest', 'Fetch.get': '$fetchGet', 'Fetch.request': '$fetchRequest', 'Timer.sleep': '$timerSleep', 'Timer.now': '$timerNow',
				'Storage.get': '$storageGet', 'Storage.set': '$storageSet', 'Storage.remove': '$storageRemove', 'Storage.clear': '$storageClear',
				'Dom.getText': '$domGetText', 'Dom.setText': '$domSetText', 'Dom.setAttribute': '$domSetAttribute', 'Dom.addClass': '$domAddClass',
				'Crypto.randomUuid': '$cryptoRandomUuid', 'Url.encodeComponent': '$urlEncodeComponent', 'Url.decodeComponent': '$urlDecodeComponent', 'Url.isValid': '$urlIsValid', 'Json.parse': 'parseJson',
			};
			if (mapped[key] !== undefined) return mapped[key];
			const symbol = expression.target.symbolId === undefined ? undefined : this.#semantic.symbols.get(expression.target.symbolId);
			const type = symbol === undefined ? undefined : this.#semantic.arena.get(symbol.typeId);
			if (symbol?.kind === 'type' && type?.kind === 'named' && type.declarationKind === 'newtype' && expression.field === 'create') return '(value => value)';
		}
		return `${this.expression(expression.target, contextName)}.${safeName(expression.field)}`;
	}

	private binary(expression: A.BinaryExpression, contextName: string): string {
		const left = this.expression(expression.left, contextName); const right = this.expression(expression.right, contextName);
		if (['==', '!='].includes(expression.operator)) return expression.operator === '==' ? `viruneEquals(${left}, ${right})` : `!viruneEquals(${left}, ${right})`;
		if (expression.inferredTypeId === this.#semantic.arena.int) {
			const helpers: Record<string, string> = { '+': 'intAdd', '-': 'intSubtract', '*': 'intMultiply', '/': 'intDivide', '%': 'intRemainder' };
			if (helpers[expression.operator] !== undefined) return `${helpers[expression.operator]}(${left}, ${right})`;
		}
		return `(${left} ${expression.operator} ${right})`;
	}

	private match(expression: A.MatchExpression, contextName: string): string {
		const temp = `$match${this.#temporary++}`;
		const lines: string[] = [`(() => {`, `\tconst ${temp} = ${this.expression(expression.target, contextName)};`];
		for (const arm of expression.arms) {
			const pattern = this.pattern(arm.pattern, temp);
			lines.push(`\tif (${pattern.condition}) {`);
			for (const binding of pattern.bindings) lines.push(`\t\t${binding}`);
			if (arm.guard !== undefined) lines.push(`\t\tif (${this.expression(arm.guard, contextName)}) return ${this.expression(arm.expression, contextName)};`);
			else lines.push(`\t\treturn ${this.expression(arm.expression, contextName)};`);
			lines.push('\t}');
		}
		lines.push(`\treturn panic('Non-exhaustive match reached at runtime');`, '})()');
		return lines.join('\n');
	}

	private pattern(pattern: A.Pattern, target: string): { condition: string; bindings: string[] } {
		switch (pattern.kind) {
			case 'WildcardPattern': return { condition: 'true', bindings: [] };
			case 'BindingPattern': return { condition: 'true', bindings: [`const ${this.nameOf(pattern.symbolId, pattern.name)} = ${target};`] };
			case 'LiteralPattern': return { condition: `viruneEquals(${target}, ${JSON.stringify(pattern.value)})`, bindings: [] };
			case 'VariantPattern': {
				const conditions = [`${target}.$tag === ${JSON.stringify(pattern.name)}`]; const bindings: string[] = [];
				pattern.values.forEach((value, index) => { const child = this.pattern(value, `${target}.$values[${index}]`); conditions.push(child.condition); bindings.push(...child.bindings); });
				return { condition: conditions.join(' && '), bindings };
			}
			case 'RecordPattern': {
				const conditions: string[] = []; const bindings: string[] = [];
				for (const field of pattern.fields) { const child = this.pattern(field.pattern, `${target}.${safeName(field.name)}`); conditions.push(child.condition); bindings.push(...child.bindings); }
				return { condition: conditions.length === 0 ? 'true' : conditions.join(' && '), bindings };
			}
			case 'RangePattern': return { condition: `Number.isSafeInteger(${target}) && ${target} >= ${pattern.start} && ${target} <= ${pattern.end}`, bindings: [] };
			case 'ListPattern': {
				const conditions = [`Array.isArray(${target})`, `${target}.length ${pattern.rest === undefined ? '===' : '>='} ${pattern.items.length}`];
				const bindings: string[] = [];
				pattern.items.forEach((item, index) => { const child = this.pattern(item, `${target}[${index}]`); conditions.push(child.condition); bindings.push(...child.bindings); });
				if (pattern.rest?.kind === 'BindingPattern') bindings.push(`const ${this.nameOf(pattern.rest.symbolId, pattern.rest.name)} = ${target}.slice(${pattern.items.length});`);
				return { condition: conditions.join(' && '), bindings };
			}
			case 'TuplePattern': {
				const conditions = [`Array.isArray(${target})`, `${target}.length === ${pattern.items.length}`];
				const bindings: string[] = [];
				pattern.items.forEach((item, index) => { const child = this.pattern(item, `${target}[${index}]`); conditions.push(child.condition); bindings.push(...child.bindings); });
				return { condition: conditions.join(' && '), bindings };
			}
			case 'OrPattern': {
				const alternatives = pattern.alternatives.map(item => this.pattern(item, target));
				return { condition: alternatives.map(item => `(${item.condition})`).join(' || '), bindings: alternatives.flatMap(item => item.bindings) };
			}
		}
	}

	private parallelExpression(expression: A.ParallelExpression, contextName: string): string {
		const helper = expression.tryMode ? 'parallelTry' : 'parallel';
		const entries = expression.entries.map(entry => `${safeName(entry.name)}: async ($child) => ${this.expression(entry.value, '$child')}`).join(', ');
		return `${helper}(${contextName}, { ${entries} })`;
	}

	private acceptsTaskContext(callee: A.Expression): boolean {
		if (callee.inferredTypeId !== undefined) {
			const inferred = this.#semantic.arena.get(callee.inferredTypeId);
			if (inferred.kind === 'function' && inferred.async) return true;
		}
		if (callee.kind === 'LambdaExpression') return callee.async;
		if (callee.kind !== 'IdentifierExpression' || callee.symbolId === undefined) return false;
		const symbol = this.#semantic.symbols.get(callee.symbolId);
		if (symbol === undefined || symbol.typeOnly) return false;
		return symbol.kind === 'function' || symbol.kind === 'import';
	}

	private typeDescriptorFromTypeId(typeId: TypeId, seen = new Set<TypeId>()): string {
		if (seen.has(typeId)) return `{ kind: 'unknown' }`;
		seen.add(typeId);
		const type = this.#semantic.arena.get(typeId);
		switch (type.kind) {
			case 'primitive':
				switch (type.name) {
					case 'String': return `{ kind: 'string' }`; case 'Bool': return `{ kind: 'bool' }`; case 'Int': return `{ kind: 'int' }`;
					case 'Float': return `{ kind: 'float' }`; case 'BigInt': return `{ kind: 'bigint' }`; case 'Unit': return `{ kind: 'unit' }`;
					default: return `{ kind: 'unknown' }`;
				}
			case 'list': return `{ kind: 'list', item: ${this.typeDescriptorFromTypeId(type.element, new Set(seen))} }`;
			case 'tuple': return `{ kind: 'tuple', items: [${type.items.map(item => this.typeDescriptorFromTypeId(item, new Set(seen))).join(', ')}] }`;
			case 'map': return `{ kind: 'map', key: ${this.typeDescriptorFromTypeId(type.key, new Set(seen))}, value: ${this.typeDescriptorFromTypeId(type.value, new Set(seen))} }`;
			case 'set': return `{ kind: 'set', item: ${this.typeDescriptorFromTypeId(type.element, new Set(seen))} }`;
			case 'option': return `{ kind: 'option', value: ${this.typeDescriptorFromTypeId(type.value, new Set(seen))} }`;
			case 'result': return `{ kind: 'result', value: ${this.typeDescriptorFromTypeId(type.value, new Set(seen))}, error: ${this.typeDescriptorFromTypeId(type.error, new Set(seen))} }`;
			case 'named': {
				if (type.definitionId === 'std:Bytes') return `{ kind: 'bytes' }`;
				if ((type.declarationKind === 'newtype' || type.declarationKind === 'alias') && type.underlying !== undefined) return this.typeDescriptorFromTypeId(type.underlying, new Set(seen));
				if (type.declarationKind === 'record' && type.fields !== undefined) {
					const declaration = this.#moduleDeclarations.find(item => item.kind === 'RecordDeclaration' && item.name === type.name) as A.RecordDeclaration | undefined;
					const strict = declaration?.attributes.some(attribute => attribute.name === 'json' && attribute.arguments.some(argument => argument.kind === 'IdentifierExpression' && argument.name === 'strict')) === true;
					return `{ kind: 'record', name: ${JSON.stringify(type.name)}, typeId: ${JSON.stringify(type.definitionId)}, fields: { ${[...type.fields].map(([name, field]) => `${JSON.stringify(name)}: ${this.recordFieldDescriptor(name, this.typeDescriptorFromTypeId(field, new Set(seen)), declaration)}`).join(', ')} }${strict ? ', strict: true' : ''} }`;
				}
				if (type.declarationKind === 'enum' && type.variants !== undefined) return `{ kind: 'enum', name: ${JSON.stringify(type.name)}, typeId: ${JSON.stringify(type.definitionId)}, variants: { ${[...type.variants].map(([name, values]) => `${JSON.stringify(name)}: [${values.map(value => this.typeDescriptorFromTypeId(value, new Set(seen))).join(', ')}]`).join(', ')} } }`;
				return `{ kind: 'unknown' }`;
			}
			default: return `{ kind: 'unknown' }`;
		}
	}

	private recordFieldDescriptor(name: string, typeDescriptor: string, declaration: A.RecordDeclaration | undefined): string {
		const field = declaration?.fields.find(item => item.name === name);
		const jsonName = field?.attributes.find(attribute => attribute.name === 'jsonName')?.arguments[0];
		const jsonDefault = field?.attributes.find(attribute => attribute.name === 'jsonDefault')?.arguments[0];
		const jsOptional = field?.attributes.some(attribute => attribute.name === 'jsOptional') === true;
		if (jsonName === undefined && jsonDefault === undefined && !jsOptional) return typeDescriptor;
		const properties = [`type: ${typeDescriptor}`];
		if (jsonName?.kind === 'LiteralExpression' && jsonName.literalKind === 'String') properties.push(`jsonName: ${JSON.stringify(jsonName.value)}`);
		if (jsonDefault !== undefined) properties.push(`hasDefault: true`, `defaultValue: ${this.expression(jsonDefault)}`);
		if (jsOptional) properties.push(`missingAsNone: true`, `omitWhenNone: true`);
		return `{ ${properties.join(', ')} }`;
	}

	private typeDescriptor(type: A.TypeReferenceNode | undefined): string {
		if (type === undefined) return `{ kind: 'unknown' }`;
		if (type.resolvedTypeId !== undefined) return this.typeDescriptorFromTypeId(type.resolvedTypeId);
		const base = (() => {
			switch (type.name) {
				case 'String': return `{ kind: 'string' }`; case 'Bool': return `{ kind: 'bool' }`; case 'Int': return `{ kind: 'int' }`;
				case 'Float': return `{ kind: 'float' }`; case 'BigInt': return `{ kind: 'bigint' }`; case 'Unit': return `{ kind: 'unit' }`;
				case 'Unknown': return `{ kind: 'unknown' }`;
				case 'Bytes': return `{ kind: 'bytes' }`;
				case 'List': return `{ kind: 'list', item: ${this.typeDescriptor(type.arguments[0])} }`;
				case 'Map': return `{ kind: 'map', key: ${this.typeDescriptor(type.arguments[0])}, value: ${this.typeDescriptor(type.arguments[1])} }`;
				case 'Set': return `{ kind: 'set', item: ${this.typeDescriptor(type.arguments[0])} }`;
				case 'Option': return `{ kind: 'option', value: ${this.typeDescriptor(type.arguments[0])} }`;
				case 'Result': return `{ kind: 'result', value: ${this.typeDescriptor(type.arguments[0])}, error: ${this.typeDescriptor(type.arguments[1])} }`;
			}
			const declaration = this.#moduleDeclarations.find(item => 'name' in item && item.name === type.name);
			if (declaration?.kind === 'RecordDeclaration') return `{ kind: 'record', name: ${JSON.stringify(type.name)}, typeId: ${JSON.stringify(this.declarationTypeId(declaration.symbolId, declaration.definitionId ?? `${this.#source.id}#${declaration.name}`))}, fields: { ${declaration.fields.map(field => `${JSON.stringify(field.name)}: ${this.recordFieldDescriptor(field.name, this.typeDescriptor(field.type), declaration)}`).join(', ')} } }`;
			if (declaration?.kind === 'EnumDeclaration') return `{ kind: 'enum', name: ${JSON.stringify(type.name)}, typeId: ${JSON.stringify(this.declarationTypeId(declaration.symbolId, declaration.definitionId ?? `${this.#source.id}#${declaration.name}`))}, variants: { ${declaration.variants.map(variant => `${JSON.stringify(variant.name)}: [${variant.values.map(value => this.typeDescriptor(value)).join(', ')}]`).join(', ')} } }`;
			if (declaration?.kind === 'NewtypeDeclaration') return this.typeDescriptor(declaration.underlying);
			if (declaration?.kind === 'TypeAliasDeclaration') return this.typeDescriptor(declaration.target);
			return `{ kind: 'unknown' }`;
		})();
		return type.optional ? `{ kind: 'option', value: ${base} }` : base;
	}

	private declarationTypeId(symbolId: SymbolId | undefined, fallback: string): string {
		if (symbolId === undefined) return fallback;
		const symbol = this.#semantic.symbols.get(symbolId);
		const type = symbol === undefined ? undefined : this.#semantic.arena.get(symbol.typeId);
		return type?.kind === 'named' ? type.definitionId : fallback;
	}

	private nameOf(symbolId: SymbolId | undefined, fallback: string): string { return symbolId === undefined ? safeName(fallback) : this.#symbolNames.get(symbolId) ?? safeName(fallback); }
	private exportPrefix(attributes: readonly A.AttributeNode[]): string { return attributes.some(item => item.name === 'jsExport') ? 'export ' : ''; }
}


export function emitJavaScript(hir: HirModule, source: SourceFile, outputFile: string, options: EmitOptions = {}): EmitResult {
	return new JavaScriptEmitter(hir, source, outputFile, options).emit(hir.module);
}
