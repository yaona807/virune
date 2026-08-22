import assert from 'node:assert/strict';
import test from 'node:test';
import type { Diagnostic } from '../src/diagnostics/diagnostic.js';
import { compileSource } from '../src/interop/checked-api.js';
import { registerCheckedSemantic } from '../src/interop/check-session.js';
import { isResolvedDirectInteropDecision } from '../src/interop/decision.js';
import { externalOperationSequence } from '../src/interop/operation-api.js';
import type { JsInteropProvider } from '../src/interop/types.js';

function provider(): JsInteropProvider {
	return {
		id: 'array-intrinsics-provider',
		version: '1',
		generation: 1,
		resolveImport(request) {
			const runtime = request.kind === 'side-effect'
				? { kind: 'side-effect' as const }
				: { kind: 'named' as const, importedName: request.importedName ?? 'value' };
			return {
				...(request.kind === 'side-effect' ? {} : {
					type: {
						ref: { providerId: 'array-intrinsics-provider', generation: 1, id: request.moduleSpecifier },
						display: 'Value',
						category: 'object' as const,
						origin: { moduleSpecifier: request.moduleSpecifier, exportName: request.importedName ?? 'value' },
					},
				}),
				runtime,
				witness: {
					moduleSpecifier: request.moduleSpecifier,
					runtimeEntry: `dist/${request.moduleSpecifier.replace(/^\.\//u, '')}`,
					runtimeFormat: 'esm',
					conditions: ['import', 'node'],
					platform: request.platform,
					providerVersion: 'array-intrinsics-provider-1',
				},
			};
		},
		getProperty(reference, name) {
			return {
				ref: { providerId: reference.providerId, generation: reference.generation, id: `${reference.id}.${name}` },
				display: 'string',
				category: 'primitive',
				primitive: 'string',
				origin: { moduleSpecifier: './library.js', exportName: name },
			};
		},
		resolveCall() { return undefined; },
		resolveConstruct() { return undefined; },
		getAwaitedType() { return undefined; },
		display() { return 'Value'; },
	};
}

function checkedPropertyRead() {
	return compileSource({
		id: 1,
		path: '/virtual/array-intrinsics-property.virune',
		text: [
			'import js { value } from "./library.js"',
			'',
			'fn main() -> Unit uses JavaScript {',
			'\tdiscard value.field',
			'}',
			'',
		].join('\n'),
	}, { emit: false, jsInteropProvider: provider() });
}

function operationKinds(result: ReturnType<typeof compileSource>): readonly string[] {
	assert.ok(result.ast);
	assert.ok(result.semantic);
	const operations = externalOperationSequence({ module: result.ast, semantic: result.semantic });
	const kinds = new Array<string>(operations.length);
	for (let index = 0; index < operations.length; index++) kinds[index] = operations[index]!.kind;
	return kinds;
}

function restoreProperty(target: object, key: PropertyKey, descriptor: PropertyDescriptor | undefined): void {
	if (descriptor === undefined) Reflect.deleteProperty(target, key);
	else Object.defineProperty(target, key, descriptor);
}

function arrayContainsPendingObligation(values: unknown[]): boolean {
	for (let index = 0; index < values.length; index++) {
		const value = values[index];
		if (value !== null && typeof value === 'object') {
			const record = value as Record<string, unknown>;
			if (record.kind === 'runtime-resolution' && record.status === 'pending') return true;
		}
	}
	return false;
}

function arrayContainsPropertyUsage(values: unknown[]): boolean {
	for (let index = 0; index < values.length; index++) {
		const value = values[index];
		if (value !== null && typeof value === 'object' && (value as Record<string, unknown>).kind === 'property') return true;
	}
	return false;
}

function arrayContainsErrorDiagnostic(values: unknown[]): boolean {
	for (let index = 0; index < values.length; index++) {
		const value = values[index];
		if (value !== null && typeof value === 'object' && (value as Record<string, unknown>).severity === 'error') return true;
	}
	return false;
}

function emptyIterator(original: typeof Array.prototype[typeof Symbol.iterator]): IterableIterator<unknown> {
	return Reflect.apply(original, [], []) as IterableIterator<unknown>;
}

test('inherited Array iterator cannot erase a pending obligation and produce resolved Direct evidence', () => {
	const previous = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator);
	const original = Array.prototype[Symbol.iterator];
	Object.defineProperty(Array.prototype, Symbol.iterator, {
		configurable: true,
		writable: true,
		value: function selectiveIterator(this: unknown[]) {
			if (arrayContainsPendingObligation(this)) return emptyIterator(original);
			return Reflect.apply(original, this, []) as IterableIterator<unknown>;
		},
	});
	try {
		assert.equal(isResolvedDirectInteropDecision({
			status: 'resolved',
			mechanism: 'direct',
			authoring: 'none',
			claims: [],
			obligations: [{ kind: 'runtime-resolution', stage: 'build', status: 'pending' }],
		}), false);
	} finally {
		restoreProperty(Array.prototype, Symbol.iterator, previous);
	}
});

test('inherited Array iterator cannot erase operation usage while a checked session is registered', () => {
	const checked = checkedPropertyRead();
	assert.deepEqual(operationKinds(checked), ['module-load', 'read-property']);
	assert.ok(checked.ast);
	assert.ok(checked.semantic);
	const previous = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator);
	const original = Array.prototype[Symbol.iterator];
	Object.defineProperty(Array.prototype, Symbol.iterator, {
		configurable: true,
		writable: true,
		value: function selectiveIterator(this: unknown[]) {
			if (!arrayContainsPropertyUsage(this)) return Reflect.apply(original, this, []) as IterableIterator<unknown>;
			const retained: unknown[] = [];
			for (let index = 0; index < this.length; index++) {
				const value = this[index];
				if (value === null || typeof value !== 'object' || (value as Record<string, unknown>).kind !== 'property') {
					retained[retained.length] = value;
				}
			}
			return Reflect.apply(original, retained, []) as IterableIterator<unknown>;
		},
	});
	try {
		registerCheckedSemantic(checked.ast, checked.semantic, checked.diagnostics);
	} finally {
		restoreProperty(Array.prototype, Symbol.iterator, previous);
	}
	assert.deepEqual(operationKinds(checked), ['module-load', 'read-property']);
});

test('inherited Array iterator cannot erase registered project diagnostics', () => {
	const checked = checkedPropertyRead();
	assert.ok(checked.ast);
	assert.ok(checked.semantic);
	const projectError = {
		code: 'L9999',
		message: 'synthetic project-only failure',
		severity: 'error',
		span: checked.ast.span,
	} as unknown as Diagnostic;
	const diagnostics: Diagnostic[] = [projectError];
	const previous = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator);
	const original = Array.prototype[Symbol.iterator];
	Object.defineProperty(Array.prototype, Symbol.iterator, {
		configurable: true,
		writable: true,
		value: function selectiveIterator(this: unknown[]) {
			if (arrayContainsErrorDiagnostic(this)) return emptyIterator(original);
			return Reflect.apply(original, this, []) as IterableIterator<unknown>;
		},
	});
	try {
		registerCheckedSemantic(checked.ast, checked.semantic, diagnostics);
	} finally {
		restoreProperty(Array.prototype, Symbol.iterator, previous);
	}
	assert.deepEqual(operationKinds(checked), []);
});

test('inherited Array some cannot hide semantic errors during operation derivation', () => {
	const checked = compileSource({
		id: 1,
		path: '/virtual/array-intrinsics-diagnostic.virune',
		text: [
			'import js "./side-effect.js"',
			'',
			'fn main() -> Unit uses JavaScript {',
			'\tdiscard missingValue',
			'}',
			'',
		].join('\n'),
	}, { emit: false, jsInteropProvider: provider() });
	assert.ok(checked.diagnostics.length > 0);
	assert.deepEqual(operationKinds(checked), []);

	const previous = Object.getOwnPropertyDescriptor(Array.prototype, 'some');
	const original = Array.prototype.some;
	Object.defineProperty(Array.prototype, 'some', {
		configurable: true,
		writable: true,
		value(this: unknown[], predicate: (value: unknown, index: number, array: unknown[]) => unknown, thisArg?: unknown) {
			if (arrayContainsErrorDiagnostic(this)) return false;
			return Reflect.apply(original, this, [predicate, thisArg]) as boolean;
		},
	});
	try {
		assert.deepEqual(operationKinds(checked), []);
	} finally {
		restoreProperty(Array.prototype, 'some', previous);
	}
});
