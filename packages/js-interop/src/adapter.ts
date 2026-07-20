import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import ts from 'typescript';

export interface InteropAdapterBuildOptions {
	readonly projectRoot: string;
	readonly sourceDir?: string;
	readonly outDir?: string;
	readonly write?: boolean;
}

export interface InteropAdapterExport {
	readonly name: string;
	readonly parameters: readonly string[];
	readonly result: string;
	readonly async: boolean;
}

export interface InteropAdapterArtifact {
	readonly sourcePath: string;
	readonly outputPath: string;
	readonly abiPath: string;
	readonly exports: readonly InteropAdapterExport[];
}

export interface InteropAdapterBuildResult {
	readonly files: readonly string[];
	readonly artifacts: readonly InteropAdapterArtifact[];
	readonly diagnostics: readonly string[];
}

interface AbiValidationResult {
	readonly exports: readonly InteropAdapterExport[];
	readonly errors: readonly string[];
}

export const INTEROP_ABI_VERSION = 1;

export interface InteropRuntimeAssetCopyResult {
	readonly files: readonly string[];
}

/** Copies local JavaScript runtime modules beside emitted Virune modules. */
export async function copyInteropRuntimeAssets(options: { readonly projectRoot: string; readonly sourceDir?: string; readonly outDir?: string }): Promise<InteropRuntimeAssetCopyResult> {
	const root = resolve(options.projectRoot);
	const sourceRoot = resolve(root, options.sourceDir ?? 'src');
	const outputRoot = resolve(root, options.outDir ?? 'dist');
	const files = await collectRuntimeAssetFiles(sourceRoot);
	for (const file of files) {
		const output = resolve(outputRoot, relative(sourceRoot, file));
		await mkdir(dirname(output), { recursive: true });
		await copyFile(file, output);
	}
	return { files };
}

/**
 * Type-checks and optionally emits every `*.interop.ts` file below sourceDir.
 * Runtime output is always plain ESM JavaScript; Node's TypeScript stripping is
 * intentionally not used as it does not perform type checking.
 */
export async function buildInteropAdapters(options: InteropAdapterBuildOptions): Promise<InteropAdapterBuildResult> {
	const root = resolve(options.projectRoot);
	const sourceRoot = resolve(root, options.sourceDir ?? 'src');
	const outputRoot = resolve(root, options.outDir ?? 'dist');
	const files = await collectAdapterFiles(sourceRoot);
	if (files.length === 0) return { files: [], artifacts: [], diagnostics: [] };

	const compilerOptions: ts.CompilerOptions = {
		target: ts.ScriptTarget.ES2022,
		module: ts.ModuleKind.NodeNext,
		moduleResolution: ts.ModuleResolutionKind.NodeNext,
		strict: true,
		strictNullChecks: true,
		exactOptionalPropertyTypes: true,
		noUncheckedIndexedAccess: true,
		noEmit: true,
		skipLibCheck: false,
		allowJs: false,
		checkJs: false,
		types: ['node'],
	};
	const program = ts.createProgram({ rootNames: files, options: compilerOptions });
	const checker = program.getTypeChecker();
	const diagnostics = ts.getPreEmitDiagnostics(program).map(formatDiagnostic);
	const artifacts: InteropAdapterArtifact[] = [];

	for (const file of files) {
		const sourceFile = program.getSourceFile(file);
		if (sourceFile === undefined) continue;
		const validation = validateAdapterSource(sourceFile, checker);
		diagnostics.push(...validation.errors);
		const outputPath = resolve(outputRoot, relative(sourceRoot, file).replace(/\.interop\.ts$/u, '.interop.mjs'));
		const abiPath = `${outputPath.slice(0, -4)}.virune-abi.json`;
		artifacts.push({ sourcePath: file, outputPath, abiPath, exports: validation.exports });
	}

	if (diagnostics.length > 0 || options.write !== true) return { files, artifacts, diagnostics };

	for (const artifact of artifacts) {
		const sourceText = await readFile(artifact.sourcePath, 'utf8');
		const transpiled = ts.transpileModule(sourceText, {
			fileName: artifact.sourcePath,
			compilerOptions: {
				target: ts.ScriptTarget.ES2022,
				module: ts.ModuleKind.ESNext,
				moduleResolution: ts.ModuleResolutionKind.Bundler,
				sourceMap: true,
				inlineSources: true,
				verbatimModuleSyntax: true,
			},
		});
		await mkdir(dirname(artifact.outputPath), { recursive: true });
		const mapName = `${artifact.outputPath.split(/[\\/]/u).at(-1)}.map`;
		const code = transpiled.outputText.replace(/\/\/# sourceMappingURL=.*$/mu, `//# sourceMappingURL=${mapName}`);
		await writeFile(artifact.outputPath, code, 'utf8');
		if (transpiled.sourceMapText !== undefined) await writeFile(`${artifact.outputPath}.map`, transpiled.sourceMapText, 'utf8');
		const normalizedExports = [...artifact.exports].sort((left, right) => left.name.localeCompare(right.name));
		const sourceHash = digest(sourceText);
		const abiHash = digest(JSON.stringify(normalizedExports));
		await writeFile(artifact.abiPath, `${JSON.stringify({
			schemaVersion: 1,
			abiVersion: INTEROP_ABI_VERSION,
			provider: { id: 'typescript', version: ts.version },
			typescriptVersion: ts.version,
			source: relative(root, artifact.sourcePath).replaceAll('\\', '/'),
			sourceHash,
			abiHash,
			exports: normalizedExports,
		}, null, 2)}\n`, 'utf8');
	}
	return { files, artifacts, diagnostics };
}

export async function createInteropAdapterTemplate(options: { readonly projectRoot: string; readonly moduleSpecifier: string; readonly output?: string }): Promise<string> {
	const root = resolve(options.projectRoot);
	const output = resolve(root, options.output ?? `src/interop/${sanitizeModuleName(options.moduleSpecifier)}.interop.ts`);
	await mkdir(dirname(output), { recursive: true });
	const text = `import * as library from ${JSON.stringify(options.moduleSpecifier)};\n\n/**\n * Keep this public surface monomorphic and callback-free.\n * Return unknown for structural data, then decode it in Virune.\n */\nexport function invoke(value: unknown): unknown {\n\tvoid library;\n\treturn value;\n}\n`;
	await writeFile(output, text, { encoding: 'utf8', flag: 'wx' });
	return output;
}

function validateAdapterSource(sourceFile: ts.SourceFile, checker: ts.TypeChecker): AbiValidationResult {
	const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
	if (moduleSymbol === undefined) return { exports: [], errors: [`${sourceFile.fileName}: cannot resolve adapter module exports`] };
	const exports: InteropAdapterExport[] = [];
	const errors: string[] = [];
	for (const symbol of checker.getExportsOfModule(moduleSymbol)) {
		if ((symbol.flags & ts.SymbolFlags.Value) === 0) continue;
		const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
		if (declaration === undefined) continue;
		const type = checker.getTypeOfSymbolAtLocation(symbol, declaration);
		const signatures = type.getCallSignatures();
		if (signatures.length !== 1) {
			errors.push(`${locationOf(declaration)}: exported value ${symbol.name} must have exactly one call signature`);
			continue;
		}
		const signature = signatures[0]!;
		if ((signature.getTypeParameters()?.length ?? 0) > 0) {
			errors.push(`${locationOf(declaration)}: exported function ${symbol.name} must not be generic`);
			continue;
		}
		const parameterTypes: string[] = [];
		let valid = true;
		for (const parameter of signature.getParameters()) {
			const parameterDeclaration = parameter.valueDeclaration ?? parameter.declarations?.[0] ?? declaration;
			const parameterType = checker.getTypeOfSymbolAtLocation(parameter, parameterDeclaration);
			const problem = abiTypeProblem(parameterType, checker, parameterDeclaration, new Set());
			if (problem !== undefined) {
				errors.push(`${locationOf(parameterDeclaration)}: parameter ${parameter.name} of ${symbol.name} is not Interop ABI v${INTEROP_ABI_VERSION} compatible: ${problem}`);
				valid = false;
			}
			parameterTypes.push(checker.typeToString(parameterType, parameterDeclaration, ts.TypeFormatFlags.NoTruncation));
		}
		const resultType = checker.getReturnTypeOfSignature(signature);
		const promised = awaitedType(checker, resultType);
		const resultValueType = promised ?? resultType;
		const resultProblem = abiTypeProblem(resultValueType, checker, signature.declaration ?? declaration, new Set());
		if (resultProblem !== undefined) {
			errors.push(`${locationOf(signature.declaration ?? declaration)}: return type of ${symbol.name} is not Interop ABI v${INTEROP_ABI_VERSION} compatible: ${resultProblem}`);
			valid = false;
		}
		if (!valid) continue;
		exports.push({
			name: symbol.name,
			parameters: parameterTypes,
			result: checker.typeToString(resultType, signature.declaration ?? declaration, ts.TypeFormatFlags.NoTruncation),
			async: promised !== undefined,
		});
	}
	return { exports: exports.sort((left, right) => left.name.localeCompare(right.name)), errors };
}

function digest(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}

function abiTypeProblem(type: ts.Type, checker: ts.TypeChecker, location: ts.Node, seen: Set<ts.Type>): string | undefined {
	if (seen.has(type)) return undefined;
	seen.add(type);
	const flags = type.getFlags();
	if ((flags & ts.TypeFlags.Any) !== 0) return 'any is not permitted; expose unknown instead';
	if ((flags & (ts.TypeFlags.Unknown | ts.TypeFlags.String | ts.TypeFlags.StringLiteral | ts.TypeFlags.Number | ts.TypeFlags.NumberLiteral | ts.TypeFlags.Boolean | ts.TypeFlags.BooleanLiteral | ts.TypeFlags.BigInt | ts.TypeFlags.BigIntLiteral | ts.TypeFlags.Void | ts.TypeFlags.Undefined | ts.TypeFlags.Null)) !== 0) return undefined;
	if ((flags & ts.TypeFlags.Never) !== 0) return 'never is not a portable runtime value';
	if (type.isUnion()) {
		for (const item of type.types) {
			const problem = abiTypeProblem(item, checker, location, seen);
			if (problem !== undefined) return problem;
		}
		return undefined;
	}
	if (type.isIntersection()) return 'intersection types must be hidden inside the adapter';
	if (checker.isArrayType(type) || checker.isTupleType(type)) return 'arrays and tuples are structural data; expose unknown and decode in Virune';
	if (type.getCallSignatures().length > 0) return 'callbacks and callable objects are not supported by Interop ABI v1';
	if (awaitedType(checker, type) !== undefined) return 'nested Promise-like values are not supported';
	if ((flags & ts.TypeFlags.Object) !== 0) {
		const symbol = type.getSymbol();
		if (symbol === undefined || symbol.name === '__type' || symbol.name === '__object') return 'anonymous structural objects must be exposed as unknown';
		const declarations = symbol.declarations ?? [];
		if (declarations.some(item => item.getSourceFile() === location.getSourceFile() && (ts.isInterfaceDeclaration(item) || ts.isTypeAliasDeclaration(item)))) return 'adapter-local structural types must be exposed as unknown';
		return undefined; // Named external object/class: opaque JS handle.
	}
	return `unsupported TypeScript type ${checker.typeToString(type, location, ts.TypeFormatFlags.NoTruncation)}`;
}

function awaitedType(checker: ts.TypeChecker, type: ts.Type): ts.Type | undefined {
	const awaited = checker.getAwaitedType(type);
	return awaited === undefined || awaited === type ? undefined : awaited;
}

async function collectRuntimeAssetFiles(root: string): Promise<string[]> {
	const output: string[] = [];
	const visit = async (directory: string): Promise<void> => {
		let entries;
		try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
		for (const entry of entries) {
			if (['node_modules', 'dist', '.git', '.virune-cache'].includes(entry.name)) continue;
			const path = join(directory, entry.name);
			if (entry.isDirectory()) await visit(path);
			else if (['.js', '.mjs', '.cjs'].includes(extname(entry.name))) output.push(path);
		}
	};
	await visit(root);
	return output.sort();
}

async function collectAdapterFiles(root: string): Promise<string[]> {
	const output: string[] = [];
	const visit = async (directory: string): Promise<void> => {
		let entries;
		try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
		for (const entry of entries) {
			if (['node_modules', 'dist', '.git', '.virune-cache'].includes(entry.name)) continue;
			const path = join(directory, entry.name);
			if (entry.isDirectory()) await visit(path);
			else if (entry.name.endsWith('.interop.ts')) output.push(path);
		}
	};
	await visit(root);
	return output.sort();
}

function formatDiagnostic(diagnostic: ts.Diagnostic): string {
	const text = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
	if (diagnostic.file === undefined || diagnostic.start === undefined) return `TypeScript: ${text}`;
	const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
	return `${diagnostic.file.fileName}:${position.line + 1}:${position.character + 1}: ${text}`;
}

function locationOf(node: ts.Node): string {
	const source = node.getSourceFile();
	const position = source.getLineAndCharacterOfPosition(node.getStart(source));
	return `${source.fileName}:${position.line + 1}:${position.character + 1}`;
}

function sanitizeModuleName(value: string): string {
	const base = value.replace(/^@/u, '').replaceAll('/', '-').replace(/[^A-Za-z0-9._-]/gu, '-');
	return extname(base) === '.ts' ? base.slice(0, -3) : base || 'adapter';
}
