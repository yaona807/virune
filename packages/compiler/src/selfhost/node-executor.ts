import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { normalizeKernelPath, type JsonValue, type KernelInputV1, type KernelOutputV1 } from './contract.js';
import { DifferentialPolicyError, type DifferentialExecutionV1, type DifferentialPanicV1 } from './differential-harness.js';

const repositoryRoot = resolve(fileURLToPath(new URL('../../../../..', import.meta.url)));

export async function executeKernelOutputWithNode(
	input: KernelInputV1,
	output: KernelOutputV1,
	{ timeoutMs = 10_000 }: { readonly timeoutMs?: number } = {},
): Promise<DifferentialExecutionV1> {
	if (!output.accepted) return emptyExecution();
	const cacheRoot = resolve(repositoryRoot, '.cache');
	await mkdir(cacheRoot, { recursive: true });
	const runtimeRoot = await mkdtemp(resolve(cacheRoot, 'selfhost-differential-runtime-'));
	try {
		for (const module of output.emittedModules) {
			const path = containedPath(runtimeRoot, module.outputPath);
			await mkdir(dirname(path), { recursive: true });
			await writeFile(path, module.code, 'utf8');
			if (module.sourceMap !== '') await writeFile(`${path}.map`, module.sourceMap, 'utf8');
		}
		const entry = output.emittedModules.find(module => module.sourcePath === input.entryPath);
		if (entry === undefined) return executionFailure('EntryOutputMissing', `No emitted module for ${input.entryPath}`, '', '', 1, null);
		const resultPath = resolve(runtimeRoot, 'result.json');
		const wrapperPath = resolve(runtimeRoot, 'run.mjs');
		const entryUrl = pathToFileURL(containedPath(runtimeRoot, entry.outputPath)).href;
		await writeFile(resolve(runtimeRoot, 'package.json'), '{"type":"module"}\n', 'utf8');
		await writeFile(wrapperPath, runtimeWrapper(entryUrl, resultPath), 'utf8');
		const result = spawnSync(process.execPath, [wrapperPath], {
			cwd: repositoryRoot,
			encoding: 'utf8',
			timeout: timeoutMs,
			maxBuffer: 64 * 1024 * 1024,
		});
		const stdout = normalizeText(result.stdout ?? '');
		const stderr = normalizeText(result.stderr ?? '');
		let runtimeResult: { readonly returnValue: JsonValue; readonly panic: DifferentialPanicV1 | null } | null = null;
		try { runtimeResult = JSON.parse(await readFile(resultPath, 'utf8')) as { readonly returnValue: JsonValue; readonly panic: DifferentialPanicV1 | null }; }
		catch { /* A hard process failure may prevent the result file from being written. */ }
		const panic = runtimeResult?.panic === null
			? null
			: runtimeResult?.panic === undefined
				? panicFromProcess(result.error, stderr, runtimeRoot)
				: normalizePanic(runtimeResult.panic, runtimeRoot);
		return {
			returnValue: canonicalJson(runtimeResult?.returnValue ?? null),
			stdout,
			stderr,
			exitCode: result.status ?? (panic === null ? 0 : 1),
			signal: result.signal,
			panic,
			events: eventTrace(stdout),
		};
	} finally {
		await rm(runtimeRoot, { recursive: true, force: true });
	}
}

function emptyExecution(): DifferentialExecutionV1 {
	return { returnValue: null, stdout: '', stderr: '', exitCode: 0, signal: null, panic: null, events: [] };
}

function executionFailure(name: string, message: string, stdout: string, stderr: string, exitCode: number, signal: string | null): DifferentialExecutionV1 {
	return { returnValue: null, stdout, stderr, exitCode, signal, panic: { name, message, stack: null }, events: eventTrace(stdout) };
}

function panicFromProcess(error: Error | undefined, stderr: string, runtimeRoot: string): DifferentialPanicV1 | null {
	if (error !== undefined) return normalizePanic({ name: error.name, message: error.message, stack: error.stack ?? null }, runtimeRoot);
	if (stderr.trim() !== '') return normalizePanic({ name: 'RuntimeProcessError', message: stderr.trim(), stack: null }, runtimeRoot);
	return null;
}

function normalizePanic(panic: DifferentialPanicV1, runtimeRoot: string): DifferentialPanicV1 {
	const normalize = (value: string): string => {
		let output = normalizeText(value);
		for (const candidate of [runtimeRoot, runtimeRoot.split(sep).join('/')]) output = output.replaceAll(candidate, '<runtime-root>');
		return output;
	};
	return { name: panic.name, message: normalize(panic.message), stack: panic.stack === null ? null : normalize(panic.stack) };
}

function eventTrace(stdout: string): readonly string[] {
	return normalizeText(stdout).split('\n').filter(line => line.length > 0);
}

function containedPath(root: string, path: string): string {
	const normalized = normalizeKernelPath(path);
	const absolute = resolve(root, ...normalized.split('/'));
	const relation = relative(root, absolute);
	if (relation === '..' || relation.startsWith(`..${sep}`)) throw new DifferentialPolicyError(`output path escapes runtime root: ${path}`);
	return absolute;
}

function canonicalJson(value: unknown): JsonValue {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
	if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
	if (typeof value === 'bigint') return { $type: 'bigint', value: value.toString() };
	if (value === undefined) return { $type: 'undefined' };
	if (Array.isArray(value)) return value.map(canonicalJson);
	if (typeof value !== 'object') return { $type: typeof value, value: String(value) };
	const record = value as Record<string, unknown>;
	const output: Record<string, JsonValue> = {};
	for (const key of Object.keys(record).sort()) output[key] = canonicalJson(record[key]);
	return output;
}

function normalizeText(value: string): string {
	return value.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
}

function runtimeWrapper(entryUrl: string, resultPath: string): string {
	return `import { writeFile } from 'node:fs/promises';\n` +
		`const resultPath = ${JSON.stringify(resultPath)};\n` +
		`const normalize = value => {\n` +
		`\tif (value === undefined) return { $type: 'undefined' };\n` +
		`\tif (typeof value === 'bigint') return { $type: 'bigint', value: value.toString() };\n` +
		`\tif (typeof value === 'number' && !Number.isFinite(value)) return String(value);\n` +
		`\tif (Array.isArray(value)) return value.map(normalize);\n` +
		`\tif (value !== null && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize(value[key])]));\n` +
		`\treturn value;\n` +
		`};\n` +
		`try {\n` +
		`\tconst module = await import(${JSON.stringify(entryUrl)});\n` +
		`\tconst value = typeof module.main === 'function' ? await module.main() : null;\n` +
		`\tawait writeFile(resultPath, JSON.stringify({ returnValue: normalize(value), panic: null }));\n` +
		`} catch (error) {\n` +
		`\tconst panic = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack ?? null } : { name: 'UnknownPanic', message: String(error), stack: null };\n` +
		`\tawait writeFile(resultPath, JSON.stringify({ returnValue: null, panic }));\n` +
		`\tprocess.exitCode = 1;\n` +
		`}\n`;
}
