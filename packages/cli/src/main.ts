#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import process from 'node:process';
import { buildProject, compileSource, diagnosticsToJson, loadConfig, renderDiagnostic, validateEntryPoint, type Diagnostic, type SourceFile } from '@virune/compiler/experimental';
import { formatSource } from '@virune/formatter';
import { buildInteropAdapters, copyInteropRuntimeAssets, createInteropAdapterTemplate, TypeScriptInteropProvider } from '@virune/js-interop';
import { generateBindings } from './bind.js';
import { createApiSnapshot } from './api.js';

class InteropAdapterBuildError extends Error {
	public constructor(readonly diagnostics: readonly string[]) { super('TypeScript interop adapter validation failed'); }
}

const VERSION = '1.0.0';
const RELEASE_ASSET_BASE = `https://github.com/yaona807/virune/releases/download/v${VERSION}`;
const releaseAsset = (file: string): string => `${RELEASE_ASSET_BASE}/${file}`;
const args = process.argv.slice(2);
const command = args[0] ?? 'help';

try {
	switch (command) {
		case '--version': case '-v': case 'version': console.log(`virune ${VERSION}`); break;
		case 'init': await initProject(resolve(args[1] ?? '.')); break;
		case 'check': process.exitCode = await checkProject(resolve(args[1] ?? '.'), args.includes('--diagnostic-format=json')); break;
		case 'build': process.exitCode = await build(resolve(args[1] ?? '.')); break;
		case 'run': process.exitCode = await runProject(resolve(args[1] ?? '.'), normalizeProgramArgs(args.slice(2))); break;
		case 'test': process.exitCode = await testProject(resolve(args[1] ?? '.')); break;
		case 'fmt': process.exitCode = await formatPaths(args.slice(1)); break;
		case 'clean': await cleanProject(resolve(args[1] ?? '.')); break;
		case 'bind': process.exitCode = await bindCommand(args.slice(1)); break;
		case 'interop': process.exitCode = await interopCommand(args.slice(1)); break;
		case 'api': process.exitCode = await apiCommand(args.slice(1)); break;
		case 'explain': explain(args[1]); break;
		case 'test-conformance': process.exitCode = await testConformance(resolve(args[1] ?? '.')); break;
		default: printHelp(); process.exitCode = command === 'help' || command === '--help' || command === '-h' ? 0 : 2;
	}
} catch (error) {
	if (error instanceof InteropAdapterBuildError) {
		for (const diagnostic of error.diagnostics) console.error(`error[INTEROP_ADAPTER]: ${diagnostic}`);
		process.exitCode = 1;
	} else {
		console.error(error instanceof Error ? error.stack ?? error.message : String(error));
		process.exitCode = 3;
	}
}

async function initProject(root: string): Promise<void> {
	await mkdir(join(root, 'src'), { recursive: true });
	await writeFile(join(root, 'virune.json'), JSON.stringify({ languageVersion: '1.0', platform: 'node', sourceDir: 'src', outDir: 'dist', entry: 'src/main.virune', target: 'es2022', sourceMap: true, sourcesContent: true }, null, 2) + '\n', { flag: 'wx' }).catch(ignoreExisting);
	await writeFile(join(root, 'src/main.virune'), 'pub fn main() -> Unit uses Console {\n\tConsole.print("Hello from Virune")\n\treturn Unit\n}\n', { flag: 'wx' }).catch(ignoreExisting);
	await writeFile(join(root, 'package.json'), JSON.stringify({ name: basename(root), private: true, type: 'module', scripts: { build: 'virune build', start: 'virune run', test: 'virune test', check: 'virune check', fmt: 'virune fmt .' }, dependencies: { '@virune/runtime': releaseAsset(`virune-runtime-${VERSION}.tgz`), '@virune/stdlib': releaseAsset(`virune-stdlib-${VERSION}.tgz`) }, devDependencies: { virune: releaseAsset(`virune-${VERSION}.tgz`) } }, null, 2) + '\n', { flag: 'wx' }).catch(ignoreExisting);
	console.log(`Initialized Virune project in ${root}`);
}

function ignoreExisting(error: unknown): void { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }

async function prepareInteropAdapters(root: string, write: boolean) {
	const config = await loadConfig(root);
	const result = await buildInteropAdapters({ projectRoot: root, sourceDir: config.sourceDir, outDir: config.outDir, write });
	if (result.diagnostics.length > 0) throw new InteropAdapterBuildError(result.diagnostics);
	if (write) await copyInteropRuntimeAssets({ projectRoot: root, sourceDir: config.sourceDir, outDir: config.outDir });
	return result;
}

async function buildViruneProject(root: string, write: boolean, additionalEntries: readonly string[]) {
	await prepareInteropAdapters(root, write);
	const jsInteropProvider = new TypeScriptInteropProvider({ projectRoot: root });
	return buildProject(root, { write, additionalEntries, jsInteropProvider });
}

async function checkProject(root: string, json: boolean): Promise<number> {
	const result = await buildViruneProject(root, false, await configuredSourceFiles(root));
	printDiagnostics(result.diagnostics, result.modules.map(module => module.source), json);
	if (result.diagnostics.some(item => item.severity === 'error')) return 1;
	console.log(`Checked ${result.modules.length} module(s).`); return 0;
}

async function build(root: string): Promise<number> {
	const result = await buildViruneProject(root, true, await configuredSourceFiles(root));
	printDiagnostics(result.diagnostics, result.modules.map(module => module.source), false);
	if (result.diagnostics.some(item => item.severity === 'error')) return 1;
	console.log(`Built ${result.modules.length} module(s) into ${resolve(root, result.config.outDir)}.`); return 0;
}


function normalizeProgramArgs(programArgs: readonly string[]): readonly string[] {
	return programArgs[0] === '--' ? programArgs.slice(1) : programArgs;
}

async function runProject(root: string, programArgs: readonly string[]): Promise<number> {
	const result = await buildViruneProject(root, true, await configuredSourceFiles(root));
	printDiagnostics(result.diagnostics, result.modules.map(module => module.source), false);
	if (result.diagnostics.some(item => item.severity === 'error')) return 1;
	const entrySource = resolve(root, result.config.entry);
	const entryModule = result.modules.find(module => resolve(module.source.path) === entrySource);
	const entry = entryModule?.outputPath;
	if (entryModule === undefined) {
		console.error('error[L5010]: Entry module was not found');
		return 1;
	}
	const validation = validateEntryPoint(entryModule);
	printDiagnostics(validation.diagnostics, [entryModule.source], false);
	if (validation.main === undefined || validation.diagnostics.some(item => item.severity === 'error')) return 1;
	if (entry === undefined) {
		console.error('error[L5010]: Entry module was not emitted');
		return 1;
	}
	const main = validation.main;
	const invocation = main.parameters.length === 0 ? 'module.main()' : `module.main(${JSON.stringify(programArgs)})`;
	const runner = join(root, '.virune-cache', 'run-entry.mjs');
	await mkdir(dirname(runner), { recursive: true });
	await writeFile(runner, `import * as module from ${JSON.stringify(pathToImport(runner, entry))};\ntry {\n\tconst result = await ${invocation};\n\tif (result?.$tag === 'Err') { console.error(result.$values[0]); process.exitCode = 1; }\n} catch (error) {\n\tconsole.error(error instanceof Error ? error.message : String(error));\n\tprocess.exitCode = 1;\n}\n`, 'utf8');
	return spawnAndWait(process.execPath, ['--enable-source-maps', runner], root);
}

async function testProject(root: string): Promise<number> {
	const config = await loadConfig(root);
	const sourceFiles = await collectViruneFiles(resolve(root, config.sourceDir));
	const patterns = config.test?.include ?? ['**/*.test.virune'];
	const testFiles = sourceFiles.filter(file => patterns.some(pattern => matchesGlob(relative(resolve(root, config.sourceDir), file).replaceAll('\\', '/'), pattern)));
	const result = await buildViruneProject(root, true, sourceFiles);
	printDiagnostics(result.diagnostics, result.modules.map(module => module.source), false);
	if (result.diagnostics.some(item => item.severity === 'error')) return 1;
	const testPaths = new Set(testFiles.map(file => resolve(file)));
	const outputs = result.modules.filter(module => testPaths.has(resolve(module.source.path)) && module.ast?.declarations.some(item => item.kind === 'TestDeclaration')).map(module => module.outputPath).filter((value): value is string => value !== undefined);
	if (outputs.length === 0) { console.log('No Virune tests found.'); return 0; }
	return spawnAndWait(process.execPath, ['--test', '--enable-source-maps', ...outputs], root);
}

async function formatPaths(rawArgs: readonly string[]): Promise<number> {
	const check = rawArgs.includes('--check');
	const roots = rawArgs.filter(arg => arg !== '--check');
	const paths = roots.length === 0 ? ['.'] : roots;
	const files = (await Promise.all(paths.map(path => collectViruneFiles(resolve(path))))).flat().sort();
	let changed = 0;
	for (const file of files) {
		const source = await readFile(file, 'utf8'); const result = formatSource(source);
		if (result.errors.length > 0) { console.error(`${file}: ${result.errors.join(', ')}`); return 1; }
		if (!result.changed) continue;
		changed++;
		if (!check) await writeFile(file, result.text, 'utf8');
		console.log(`${check ? 'Would format' : 'Formatted'} ${file}`);
	}
	if (check && changed > 0) return 1;
	console.log(`${check ? 'Checked' : 'Formatted'} ${files.length} file(s).`); return 0;
}

async function configuredSourceFiles(root: string): Promise<string[]> {
	try {
		const config = await loadConfig(root);
		return await collectViruneFiles(resolve(root, config.sourceDir));
	} catch {
		return [];
	}
}

async function collectViruneFiles(path: string): Promise<string[]> {
	const info = await stat(path);
	if (info.isFile()) return path.endsWith('.virune') ? [path] : [];
	const output: string[] = [];
	for (const entry of await readdir(path, { withFileTypes: true })) {
		if (['node_modules', 'dist', '.git', '.virune-cache'].includes(entry.name)) continue;
		const child = join(path, entry.name);
		if (entry.isDirectory()) output.push(...await collectViruneFiles(child));
		else if (entry.name.endsWith('.virune')) output.push(child);
	}
	return output;
}

async function bindCommand(commandArgs: readonly string[]): Promise<number> {
	const input = commandArgs.find(argument => !argument.startsWith('--'));
	if (input === undefined) { console.error('Usage: virune bind <package-or-d.ts> [--out path] [--module specifier]'); return 2; }
	const valueAfter = (name: string): string | undefined => { const index = commandArgs.indexOf(name); return index < 0 ? undefined : commandArgs[index + 1]; };
	const output = valueAfter('--out');
	const moduleSpecifier = valueAfter('--module');
	const result = await generateBindings({ cwd: process.cwd(), input, ...(output === undefined ? {} : { output }), ...(moduleSpecifier === undefined ? {} : { moduleSpecifier }) });
	console.log(`Generated ${result.generatedFunctions} function binding(s) and ${result.generatedRecords} record binding(s) in ${result.outputPath} (${result.unknownMappings} Unknown fallback(s))`);
	for (const warning of result.warnings) console.warn(`warning: ${warning}`);
	return 0;
}

async function interopCommand(commandArgs: readonly string[]): Promise<number> {
	const subcommand = commandArgs[0] ?? 'check';
	const valueAfter = (name: string): string | undefined => { const index = commandArgs.indexOf(name); return index < 0 ? undefined : commandArgs[index + 1]; };
	if (subcommand === 'init') {
		const moduleSpecifier = commandArgs[1];
		if (moduleSpecifier === undefined) { console.error('Usage: virune interop init <module> [--out path]'); return 2; }
		const output = await createInteropAdapterTemplate({ projectRoot: process.cwd(), moduleSpecifier, ...(valueAfter('--out') === undefined ? {} : { output: valueAfter('--out')! }) });
		console.log(`Created TypeScript interop adapter ${output}`);
		return 0;
	}
	if (subcommand !== 'check' && subcommand !== 'build') {
		console.error('Usage: virune interop <check|build|init> [path]');
		return 2;
	}
	const root = resolve(commandArgs[1] ?? '.');
	try {
		const result = await prepareInteropAdapters(root, subcommand === 'build');
		console.log(`${subcommand === 'build' ? 'Built' : 'Checked'} ${result.files.length} TypeScript interop adapter(s).`);
		return 0;
	} catch (error) {
		if (!(error instanceof InteropAdapterBuildError)) throw error;
		for (const diagnostic of error.diagnostics) console.error(`error[INTEROP_ADAPTER]: ${diagnostic}`);
		return 1;
	}
}

async function apiCommand(commandArgs: readonly string[]): Promise<number> {
	const valueAfter = (name: string): string | undefined => {
		const index = commandArgs.indexOf(name);
		return index < 0 ? undefined : commandArgs[index + 1];
	};
	const positional: string[] = [];
	for (let index = 0; index < commandArgs.length; index++) {
		const argument = commandArgs[index]!;
		if (argument === '--out') { index++; continue; }
		if (argument.startsWith('--')) continue;
		positional.push(argument);
	}
	const root = resolve(positional[0] ?? '.');
	const output = valueAfter('--out');
	const check = commandArgs.includes('--check');
	const result = await createApiSnapshot({ root, ...(output === undefined ? {} : { output }), check });
	console.log(`${check ? 'Checked' : 'Wrote'} public API snapshot ${result.path}`);
	return 0;
}

async function cleanProject(root: string): Promise<void> {
	let outDir = 'dist';
	try { const config = JSON.parse(await readFile(join(root, 'virune.json'), 'utf8')) as { outDir?: string }; outDir = config.outDir ?? outDir; } catch {}
	await Promise.all([rm(resolve(root, outDir), { recursive: true, force: true }), rm(join(root, '.virune-cache'), { recursive: true, force: true })]);
	console.log('Removed Virune build artifacts.');
}

async function testConformance(root: string): Promise<number> {
	const directory = join(root, 'conformance');
	const files = await collectViruneFiles(directory).catch(() => []);
	let failed = 0;
	for (const [index, file] of files.entries()) {
		const source: SourceFile = { id: index + 1, path: file, text: await readFile(file, 'utf8') };
		const result = compileSource(source, { emit: false });
		const expectationPath = `${file}.expected.json`;
		let expectation: ConformanceExpectation;
		try {
			expectation = JSON.parse(await readFile(expectationPath, 'utf8')) as ConformanceExpectation;
		} catch (error) {
			failed++;
			console.error(`${relative(root, file)}: missing or invalid expectation file ${relative(root, expectationPath)} (${error instanceof Error ? error.message : String(error)})`);
			continue;
		}
		const actual = normalizeDiagnostics(result.diagnostics);
		const expectedStatus = actual.some(item => item.severity === 'error') ? 'compile-error' : 'compile-success';
		if (expectation.schemaVersion !== 1 || expectation.status !== expectedStatus || JSON.stringify(expectation.diagnostics) !== JSON.stringify(actual)) {
			failed++;
			console.error(`${relative(root, file)}: conformance expectation mismatch`);
			console.error(`expected: ${JSON.stringify(expectation, null, 2)}`);
			console.error(`actual:   ${JSON.stringify({ schemaVersion: 1, status: expectedStatus, diagnostics: actual }, null, 2)}`);
		}
	}
	console.log(`${files.length - failed}/${files.length} conformance files passed.`); return failed === 0 ? 0 : 1;
}

interface ConformanceDiagnosticExpectation {
	readonly severity: Diagnostic['severity'];
	readonly code: string;
	readonly line: number;
	readonly column: number;
	readonly endLine: number;
	readonly endColumn: number;
}

interface ConformanceExpectation {
	readonly schemaVersion: 1;
	readonly rules?: readonly string[];
	readonly status: 'compile-success' | 'compile-error';
	readonly diagnostics: readonly ConformanceDiagnosticExpectation[];
}

function normalizeDiagnostics(diagnostics: readonly Diagnostic[]): ConformanceDiagnosticExpectation[] {
	return diagnostics.map(item => ({
		severity: item.severity,
		code: item.code,
		line: item.span.start.line,
		column: item.span.start.column,
		endLine: item.span.end.line,
		endColumn: item.span.end.column,
	}));
}


function matchesGlob(path: string, pattern: string): boolean {
	let source = '^';
	for (let index = 0; index < pattern.length; index++) {
		const character = pattern[index]!;
		if (character === '*' && pattern[index + 1] === '*') {
			if (pattern[index + 2] === '/') { source += '(?:.*/)?'; index += 2; }
			else { source += '.*'; index++; }
		} else if (character === '*') source += '[^/]*';
		else if (character === '?') source += '[^/]';
		else source += /[\\.^$+{}()|[\]]/u.test(character) ? `\\${character}` : character;
	}
	return new RegExp(`${source}$`, 'u').test(path);
}

function printDiagnostics(diagnostics: readonly Diagnostic[], files: readonly SourceFile[], json: boolean): void {
	if (diagnostics.length === 0) return;
	const map = new Map(files.map(file => [file.id, file]));
	if (json) { console.log(diagnosticsToJson(diagnostics, map)); return; }
	for (const diagnostic of diagnostics) { const file = map.get(diagnostic.span.fileId); console.error(file === undefined ? `${diagnostic.severity}[${diagnostic.code}]: ${diagnostic.message}` : renderDiagnostic(diagnostic, file)); }
}

function explain(code: string | undefined): void {
	const explanations: Record<string, string> = {
		L0001: 'The lexer found a character sequence that is not valid Virune syntax.', L0002: 'The parser could not match the source against the Virune grammar.',
		L2043: 'A value was used where an incompatible type was required. Virune performs no implicit numeric or string conversions.',
		L3004: 'A match expression omitted at least one enum, Option, or Result variant.', L4002: 'Virune modules must form an acyclic dependency graph.',
	};
	if (code === undefined || explanations[code] === undefined) { console.error('Unknown diagnostic code. Example: virune explain L2043'); process.exitCode = 2; return; }
	console.log(`${code}: ${explanations[code]}`);
}

function printHelp(): void {
	console.log(`Virune ${VERSION}\n\nUsage: virune <command> [path]\n\nCommands:\n  init       Create a project\n  check      Parse and type-check\n  build      Emit ES2022 modules\n  run        Build and run pub fn main (use -- before program arguments)\n  test       Build and run Virune tests\n  fmt        Format .virune files\n  clean      Remove generated files\n  bind       Generate safe FFI bindings from .d.ts\n  interop    Check or build TypeScript interop adapters\n  api        Write or check the public API snapshot\n  explain    Explain a diagnostic code\n  version    Print the version`);
}

function pathToImport(from: string, target: string): string { let value = relative(dirname(from), target).replaceAll('\\', '/'); if (!value.startsWith('.')) value = `./${value}`; return value; }
function spawnAndWait(command: string, childArgs: readonly string[], cwd: string): Promise<number> {
	const { NODE_TEST_CONTEXT: _nodeTestContext, ...env } = process.env;
	return new Promise((resolvePromise, reject) => {
		const child = spawn(command, childArgs, { cwd, stdio: 'inherit', env });
		child.once('error', reject);
		child.once('exit', code => resolvePromise(code ?? 1));
	});
}
