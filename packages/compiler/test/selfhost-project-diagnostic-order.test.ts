import assert from 'node:assert/strict';
import test from 'node:test';
import type { KernelInputV1 } from '../src/selfhost/contract.js';
import {
	compileWithProjectCompilerBoundary,
	type ProjectCompilerDiagnosticV1,
	type ProjectCompilerResultV1,
} from '../src/selfhost/project-compiler-adapter.js';

const input: KernelInputV1 = {
	contractVersion: '1',
	languageVersion: '1.0',
	platform: 'node',
	entryPath: 'src/main.virune',
	sources: [
		{ path: 'src/a.virune', text: '' },
		{ path: 'src/main.virune', text: '' },
	],
	interopManifest: { version: '1', modules: [] },
	emit: { target: 'es2022', sourceMap: false, sourcesContent: true },
};

const diagnostic = (
	code: string,
	sourcePath: string | null,
	offset: number,
	message = code,
): ProjectCompilerDiagnosticV1 => ({
	code,
	severity: 'error',
	message,
	sourcePath,
	span: {
		start: { offset, line: offset + 1, column: 1 },
		end: { offset: offset + 1, line: offset + 1, column: 2 },
	},
	notes: [],
});

const canonicalDiagnostics = [
	diagnostic('SHP1001', null, 0, 'global request failure'),
	diagnostic('L1000', 'src/a.virune', 1, 'first source failure'),
	diagnostic('L1001', 'src/main.virune', 2, 'entry source failure'),
] as const;

function result(diagnostics: readonly ProjectCompilerDiagnosticV1[]): ProjectCompilerResultV1 {
	return {
		contractVersion: '1',
		languageVersion: '1.0',
		platform: 'node',
		entryPath: input.entryPath,
		accepted: false,
		diagnostics,
		emittedModules: [],
		dependencies: [],
		exportedSymbols: [],
		stats: {
			parsedModules: 2,
			reusedParsedModules: 0,
			checkedModules: 0,
			reusedCheckedModules: 0,
			emittedModules: 0,
			reusedEmittedModules: 0,
			invalidatedModules: 0,
		},
	};
}

function compilerReturning(value: ProjectCompilerResultV1) {
	return {
		compileMvp: (_source: string) => ({ $tag: 'Ok' as const, $values: ['{}'] as const }),
		projectCompilerCapability: () => ({
			$tag: 'Ok' as const,
			$values: [JSON.stringify({
				contractVersion: '1',
				ready: true,
				requestSchema: 'virune.selfhost.project-compiler.request.v1',
				resultSchema: 'virune.selfhost.project-compiler.result.v2',
				blockers: [],
			})] as const,
		}),
		compileProjectMvp: (_request: string) => ({
			$tag: 'Ok' as const,
			$values: [JSON.stringify(value)] as const,
		}),
	};
}

test('project compiler boundary preserves canonical diagnostic order', () => {
	const output = compileWithProjectCompilerBoundary(
		compilerReturning(result(canonicalDiagnostics)),
		input,
	);
	assert.deepEqual(output.diagnostics, canonicalDiagnostics);
});

test('project compiler boundary rejects non-canonical diagnostic order', () => {
	assert.throws(
		() => compileWithProjectCompilerBoundary(
			compilerReturning(result([...canonicalDiagnostics].reverse())),
			input,
		),
		/\$\.diagnostics must be sorted/u,
	);
});

test('project compiler boundary rejects duplicate diagnostic witnesses', () => {
	assert.throws(
		() => compileWithProjectCompilerBoundary(
			compilerReturning(result([
				canonicalDiagnostics[0],
				canonicalDiagnostics[0],
			])),
			input,
		),
		/\$\.diagnostics must be unique/u,
	);
});
