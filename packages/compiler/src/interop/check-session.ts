import type * as A from '../ast/nodes.js';
import type { SemanticModel } from '../checker/checker.js';
import type { Diagnostic } from '../diagnostics/diagnostic.js';
import { checkedScopeWitness, currentCheckedBuiltinWitness } from '../session-witness.js';
import type {
	ForeignOrigin,
	ForeignTypeSnapshot,
	ForeignUsage,
	ForeignUsageIR,
	InteropSemanticModel,
	ModuleResolutionWitness,
	StableForeignTypeSnapshot,
} from './types.js';

interface CheckedSession {
	readonly checkerWitness: object;
	readonly moduleState: string;
	readonly interop: InteropSemanticModel;
	readonly semanticDiagnostics: readonly Diagnostic[];
	readonly evidenceState: string;
	readonly diagnostics: readonly Diagnostic[];
	readonly diagnosticsState: string;
}

const currentSessionByModule = new WeakMap<A.ModuleNode, CheckedSession>();
const sessionBySemantic = new WeakMap<object, CheckedSession>();

/** Invalidate any previously registered public semantic session for this AST object. */
export function invalidateCheckedSemantic(module: A.ModuleNode): void {
	currentSessionByModule.delete(module);
}

/** Bind one semantic result to the exact post-check AST, evidence, and compilation diagnostics. */
export function registerCheckedSemantic(
	module: A.ModuleNode,
	semantic: SemanticModel,
	diagnostics: readonly Diagnostic[] = semantic.diagnostics.items,
): void {
	const checkerWitness = checkedScopeWitness(semantic.globalScope);
	if (checkerWitness === undefined) throw new Error('Cannot register checked semantic without an untainted checker-owned scope witness');
	if (currentCheckedBuiltinWitness(module.span) !== checkerWitness) {
		throw new Error('Cannot re-register checked semantic after its checker witness has changed');
	}
	const interop = semantic.interop;
	const semanticDiagnostics = semantic.diagnostics.items;
	const registeredDiagnostics = Object.freeze([...diagnostics]);
	const session: CheckedSession = Object.freeze({
		checkerWitness,
		moduleState: structuralState(module),
		interop,
		semanticDiagnostics,
		evidenceState: checkedEvidenceState(interop, semanticDiagnostics),
		diagnostics: registeredDiagnostics,
		diagnosticsState: structuralState(registeredDiagnostics),
	});
	currentSessionByModule.set(module, session);
	sessionBySemantic.set(semantic, session);
}

/**
 * A semantic result is current only while its object identity, checker witness,
 * post-check data, and the diagnostics registered for that exact compilation
 * remain unchanged.
 */
export function isCurrentCheckedSemantic(module: A.ModuleNode, semantic: SemanticModel): boolean {
	const session = sessionBySemantic.get(semantic);
	if (session === undefined || currentSessionByModule.get(module) !== session) return false;
	if (checkedScopeWitness(semantic.globalScope) !== session.checkerWitness) return false;
	if (currentCheckedBuiltinWitness(module.span) !== session.checkerWitness) return false;
	try {
		if (semantic.interop !== session.interop || semantic.diagnostics.items !== session.semanticDiagnostics) return false;
		return session.moduleState === structuralState(module)
			&& session.evidenceState === checkedEvidenceState(session.interop, session.semanticDiagnostics)
			&& session.diagnosticsState === structuralState(session.diagnostics);
	} catch {
		return false;
	}
}

/** Return the immutable diagnostic snapshot bound to the current checked session. */
export function currentCheckedDiagnostics(
	module: A.ModuleNode,
	semantic: SemanticModel,
): readonly Diagnostic[] | undefined {
	if (!isCurrentCheckedSemantic(module, semantic)) return undefined;
	return sessionBySemantic.get(semantic)?.diagnostics;
}

/** Return the exact checked Interop evidence object registered for this semantic session. */
export function currentCheckedInterop(
	module: A.ModuleNode,
	semantic: SemanticModel,
): InteropSemanticModel | undefined {
	if (!isCurrentCheckedSemantic(module, semantic)) return undefined;
	return sessionBySemantic.get(semantic)?.interop;
}

function checkedEvidenceState(interop: InteropSemanticModel, diagnostics: readonly Diagnostic[]): string {
	return structuralState({
		diagnostics,
		interop: checkedInteropEvidence(interop),
	});
}

/**
 * Fingerprint only facts consumed by External Operation derivation.
 * Provider-private/navigation metadata is deliberately not enumerated: it is
 * neither stable evidence nor a session truth source.
 */
function checkedInteropEvidence(interop: InteropSemanticModel): unknown {
	const usages = readDenseDataArray(ownDataProperty(interop, 'usages', 'checked Interop evidence'), 'checked Interop usages');
	const usageIR = readDenseDataArray(ownDataProperty(interop, 'usageIR', 'checked Interop evidence'), 'checked Interop usage IR');
	const moduleWitnesses = readDenseDataArray(ownDataProperty(interop, 'moduleWitnesses', 'checked Interop evidence'), 'checked Interop module witnesses');
	return {
		usages: usages
			.filter(usage => ownDataProperty(usage, 'kind', 'checked Interop usage') !== 'import')
			.map(checkedUsageEvidence),
		usageIR: usageIR.map(checkedUsageEvidence),
		moduleWitnesses: moduleWitnesses.map(checkedModuleWitnessEvidence),
		requiresJavaScriptInitialization: ownDataProperty(interop, 'requiresJavaScriptInitialization', 'checked Interop evidence'),
	};
}

function checkedUsageEvidence(usage: ForeignUsage | ForeignUsageIR | unknown): unknown {
	const kind = ownDataProperty(usage, 'kind', 'checked Interop usage');
	const nodeId = ownDataProperty(usage, 'nodeId', 'checked Interop usage');
	const span = ownDataProperty(usage, 'span', 'checked Interop usage');
	const anchor = {
		kind,
		nodeId,
		span: checkedSpanEvidence(span),
	};
	if (kind === 'import') return anchor;
	const foreignType = ownDataProperty(usage, 'foreignType', 'checked Interop usage');
	const bridge = kind === 'bridge' ? ownOptionalDataProperty(usage, 'bridge', 'checked Interop usage') : undefined;
	return {
		...anchor,
		foreignType: checkedForeignTypeEvidence(foreignType),
		...(kind === 'call' ? {
			receiverMode: ownOptionalDataProperty(usage, 'receiverMode', 'checked Interop usage'),
			mayReject: ownOptionalDataProperty(usage, 'mayReject', 'checked Interop usage'),
		} : {}),
		...(kind === 'await' ? { mayReject: ownOptionalDataProperty(usage, 'mayReject', 'checked Interop usage') } : {}),
		...(kind === 'bridge' ? {
			bridge: bridge === undefined ? undefined : {
				kind: ownDataProperty(bridge, 'kind', 'checked Interop bridge'),
				bridge: ownDataProperty(bridge, 'bridge', 'checked Interop bridge'),
			},
		} : {}),
	};
}

function checkedForeignTypeEvidence(snapshot: ForeignTypeSnapshot | StableForeignTypeSnapshot | unknown): unknown {
	const origin = ownOptionalDataProperty(snapshot, 'origin', 'checked foreign type');
	return {
		category: ownDataProperty(snapshot, 'category', 'checked foreign type'),
		primitive: ownOptionalDataProperty(snapshot, 'primitive', 'checked foreign type'),
		mustUse: ownOptionalDataProperty(snapshot, 'mustUse', 'checked foreign type'),
		origin: origin === undefined ? undefined : checkedOriginEvidence(origin),
	};
}

function checkedOriginEvidence(origin: ForeignOrigin | unknown): unknown {
	return {
		moduleSpecifier: ownDataProperty(origin, 'moduleSpecifier', 'checked foreign origin'),
		packageName: ownOptionalDataProperty(origin, 'packageName', 'checked foreign origin'),
		packageVersion: ownOptionalDataProperty(origin, 'packageVersion', 'checked foreign origin'),
		exportName: ownOptionalDataProperty(origin, 'exportName', 'checked foreign origin'),
	};
}

function checkedModuleWitnessEvidence(witness: ModuleResolutionWitness | unknown): unknown {
	const conditionValues = readDenseDataArray(ownDataProperty(witness, 'conditions', 'checked module witness'), 'checked module witness conditions');
	const conditions = [...new Set(conditionValues.map(condition => {
		if (typeof condition !== 'string') throw new Error('checked module witness condition must be a string');
		return condition;
	}))].sort(compareText);
	return {
		moduleSpecifier: ownDataProperty(witness, 'moduleSpecifier', 'checked module witness'),
		packageName: ownOptionalDataProperty(witness, 'packageName', 'checked module witness'),
		packageVersion: ownOptionalDataProperty(witness, 'packageVersion', 'checked module witness'),
		runtimeEntry: ownOptionalDataProperty(witness, 'runtimeEntry', 'checked module witness'),
		runtimeFormat: ownOptionalDataProperty(witness, 'runtimeFormat', 'checked module witness'),
		conditions,
		platform: ownDataProperty(witness, 'platform', 'checked module witness'),
		packageJsonHash: ownOptionalDataProperty(witness, 'packageJsonHash', 'checked module witness'),
	};
}

function checkedSpanEvidence(span: ForeignUsage['span'] | unknown): unknown {
	const start = ownDataProperty(span, 'start', 'checked source span');
	const end = ownDataProperty(span, 'end', 'checked source span');
	return {
		fileId: ownDataProperty(span, 'fileId', 'checked source span'),
		start: {
			offset: ownDataProperty(start, 'offset', 'checked source position'),
			line: ownDataProperty(start, 'line', 'checked source position'),
			column: ownDataProperty(start, 'column', 'checked source position'),
		},
		end: {
			offset: ownDataProperty(end, 'offset', 'checked source position'),
			line: ownDataProperty(end, 'line', 'checked source position'),
			column: ownDataProperty(end, 'column', 'checked source position'),
		},
	};
}

function ownDataProperty(value: unknown, key: string, description: string): unknown {
	if (value === null || typeof value !== 'object') throw new Error(`${description} must be an object`);
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (descriptor === undefined) throw new Error(`${description} is missing field ${key}`);
	if (!('value' in descriptor)) throw new Error(`${description} field ${key} must be a data property`);
	return descriptor.value;
}

function ownOptionalDataProperty(value: unknown, key: string, description: string): unknown {
	if (value === null || typeof value !== 'object') throw new Error(`${description} must be an object`);
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (descriptor === undefined) return undefined;
	if (!('value' in descriptor)) throw new Error(`${description} field ${key} must be a data property`);
	return descriptor.value;
}

function readDenseDataArray(value: unknown, description: string): readonly unknown[] {
	if (!Array.isArray(value)) throw new Error(`${description} must be an array`);
	const keys = Reflect.ownKeys(value);
	const symbolKey = keys.find((key): key is symbol => typeof key === 'symbol');
	if (symbolKey !== undefined) throw new Error(`Unknown ${description} field: ${String(symbolKey)}`);
	const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
	if (lengthDescriptor === undefined || !('value' in lengthDescriptor) || typeof lengthDescriptor.value !== 'number' || !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0) {
		throw new Error(`${description} has an invalid length`);
	}
	const length = lengthDescriptor.value;
	const indexKeys = (keys as string[]).filter(key => key !== 'length');
	if (indexKeys.length !== length) throw new Error(`${description} must be a dense array without extra fields`);
	const indexes = indexKeys.map(key => {
		const index = Number(key);
		if (!Number.isSafeInteger(index) || index < 0 || index >= length || String(index) !== key) throw new Error(`Unknown ${description} field: ${key}`);
		return index;
	}).sort((left, right) => left - right);
	if (indexes.some((index, position) => index !== position)) throw new Error(`${description} must be a dense array without extra fields`);
	return indexes.map(index => {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (descriptor === undefined) throw new Error(`${description} is missing index ${index}`);
		if (!('value' in descriptor)) throw new Error(`${description} field ${index} must be a data property`);
		return descriptor.value;
	});
}

function structuralState(value: unknown): string {
	return encodeStructuralValue(value, new Map<object, number>());
}

function encodeStructuralValue(value: unknown, seen: Map<object, number>): string {
	if (value === null) return 'null';
	if (value === undefined) return 'undefined';
	if (typeof value === 'string') return `string:${JSON.stringify(value)}`;
	if (typeof value === 'boolean') return value ? 'boolean:true' : 'boolean:false';
	if (typeof value === 'bigint') return `bigint:${value.toString(10)}`;
	if (typeof value === 'number') {
		if (Number.isNaN(value)) return 'number:NaN';
		if (value === Number.POSITIVE_INFINITY) return 'number:+Infinity';
		if (value === Number.NEGATIVE_INFINITY) return 'number:-Infinity';
		if (Object.is(value, -0)) return 'number:-0';
		return `number:${String(value)}`;
	}
	if (typeof value === 'function') return `function:${value.name}`;
	if (typeof value === 'symbol') return `symbol:${String(value.description ?? '')}`;
	if (typeof value !== 'object') return `${typeof value}:${String(value)}`;

	const existing = seen.get(value);
	if (existing !== undefined) return `reference:${existing}`;
	const id = seen.size;
	seen.set(value, id);

	if (Array.isArray(value)) {
		const items = readDenseDataArray(value, 'checked structural array');
		return `array:${id}:[${items.map(item => encodeStructuralValue(item, seen)).join(',')}]`;
	}
	const keys = Reflect.ownKeys(value);
	const symbolKey = keys.find((key): key is symbol => typeof key === 'symbol');
	if (symbolKey !== undefined) throw new Error(`checked structural object contains symbol field ${String(symbolKey)}`);
	const stringKeys = (keys as string[]).sort(compareText);
	const fields = stringKeys.map(key => {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (descriptor === undefined) throw new Error(`checked structural object is missing field ${key}`);
		if (!('value' in descriptor)) throw new Error(`checked structural object field ${key} must be a data property`);
		return `${JSON.stringify(key)}=${encodeStructuralValue(descriptor.value, seen)}`;
	});
	return `object:${id}:{${fields.join(',')}}`;
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
