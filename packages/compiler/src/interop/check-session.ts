import type * as A from '../ast/nodes.js';
import type { SemanticModel } from '../checker/checker.js';
import type { Diagnostic } from '../diagnostics/diagnostic.js';
import { checkedScopeWitness, currentCheckedBuiltinWitness } from '../session-witness.js';
import {
	copyArrayByIndex,
	filterArrayByIndex,
	mapArrayByIndex,
	readDenseOwnDataArray,
	sortArrayByIndex,
	uniqueArrayByIndex,
} from './array-safety.js';
import type {
	ForeignOrigin,
	ForeignTypeRef,
	ForeignTypeSnapshot,
	ForeignUsage,
	ForeignUsageIR,
	InteropSemanticModel,
	ModuleResolutionWitness,
	PrimitiveBridgePlan,
	StableForeignTypeSnapshot,
} from './types.js';

interface CheckedSession {
	readonly checkerWitness: object;
	readonly moduleState: string;
	readonly interop: InteropSemanticModel;
	readonly operationInterop: InteropSemanticModel;
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
	const operationInterop = snapshotOperationInterop(interop);
	const registeredDiagnostics = Object.freeze(copyArrayByIndex(diagnostics));
	const session: CheckedSession = Object.freeze({
		checkerWitness,
		moduleState: structuralState(module),
		interop,
		operationInterop,
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

/**
 * Return the private checker-time Interop snapshot used for operation derivation.
 * Public SemanticModel objects remain observable for mutation detection, but are
 * never consumed live after the current-session check succeeds.
 */
export function currentCheckedInterop(
	module: A.ModuleNode,
	semantic: SemanticModel,
): InteropSemanticModel | undefined {
	if (!isCurrentCheckedSemantic(module, semantic)) return undefined;
	return sessionBySemantic.get(semantic)?.operationInterop;
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
	const nonImportUsages = filterArrayByIndex(usages, usage => ownDataProperty(usage, 'kind', 'checked Interop usage') !== 'import');
	return {
		usages: mapArrayByIndex(nonImportUsages, checkedUsageEvidence),
		usageIR: mapArrayByIndex(usageIR, checkedUsageEvidence),
		moduleWitnesses: mapArrayByIndex(moduleWitnesses, checkedModuleWitnessEvidence),
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
	const validatedConditions = mapArrayByIndex(conditionValues, condition => {
		if (typeof condition !== 'string') throw new Error('checked module witness condition must be a string');
		return condition;
	});
	const conditions = sortArrayByIndex(uniqueArrayByIndex(validatedConditions), compareText);
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

/**
 * Clone only operation-relevant checked facts into frozen null-prototype data.
 * Provider object/prototype behavior and later public collection mutation cannot
 * become operation truth, including inherited values for omitted optional fields.
 */
function snapshotOperationInterop(interop: InteropSemanticModel): InteropSemanticModel {
	const usages: ForeignUsage[] = [];
	const usageValues = readDenseDataArray(ownDataProperty(interop, 'usages', 'checked Interop evidence'), 'checked Interop usages');
	for (let index = 0; index < usageValues.length; index++) {
		const usage = usageValues[index];
		if (ownDataProperty(usage, 'kind', 'checked Interop usage') === 'import') continue;
		usages[usages.length] = snapshotForeignUsage(usage);
	}
	const usageIR: ForeignUsageIR[] = [];
	const usageIRValues = readDenseDataArray(ownDataProperty(interop, 'usageIR', 'checked Interop evidence'), 'checked Interop usage IR');
	for (let index = 0; index < usageIRValues.length; index++) {
		const usage = usageIRValues[index];
		if (ownDataProperty(usage, 'kind', 'checked Interop usage') === 'import') continue;
		usageIR[usageIR.length] = snapshotForeignUsageIR(usage);
	}
	const moduleWitnessValues = readDenseDataArray(
		ownDataProperty(interop, 'moduleWitnesses', 'checked Interop evidence'),
		'checked Interop module witnesses',
	);
	const moduleWitnesses = mapArrayByIndex(moduleWitnessValues, snapshotModuleWitness);
	const requiresJavaScriptInitialization = ownDataProperty(interop, 'requiresJavaScriptInitialization', 'checked Interop evidence');
	if (typeof requiresJavaScriptInitialization !== 'boolean') throw new Error('checked Interop initialization state must be boolean');
	return freezeSnapshotRecord({
		usages: Object.freeze(usages),
		usageIR: Object.freeze(usageIR),
		moduleWitnesses: Object.freeze(moduleWitnesses),
		requiresJavaScriptInitialization,
	});
}

function snapshotForeignUsage(value: unknown): ForeignUsage {
	const kind = nonImportUsageKind(value);
	const base = {
		kind,
		nodeId: ownDataProperty(value, 'nodeId', 'checked Interop usage') as ForeignUsage['nodeId'],
		span: snapshotSourceSpan(ownDataProperty(value, 'span', 'checked Interop usage')),
		foreignType: snapshotForeignType(ownDataProperty(value, 'foreignType', 'checked Interop usage')),
	};
	if (kind === 'call') {
		const receiverMode = ownOptionalDataProperty(value, 'receiverMode', 'checked Interop usage');
		const mayReject = ownOptionalDataProperty(value, 'mayReject', 'checked Interop usage');
		return freezeSnapshotRecord({
			...base,
			...(receiverMode === undefined ? {} : { receiverMode: receiverMode as NonNullable<ForeignUsage['receiverMode']> }),
			...(mayReject === undefined ? {} : { mayReject: mayReject as boolean }),
		});
	}
	if (kind === 'await') {
		const mayReject = ownOptionalDataProperty(value, 'mayReject', 'checked Interop usage');
		return freezeSnapshotRecord({
			...base,
			...(mayReject === undefined ? {} : { mayReject: mayReject as boolean }),
		});
	}
	if (kind === 'bridge') {
		const bridge = ownOptionalDataProperty(value, 'bridge', 'checked Interop usage');
		return freezeSnapshotRecord({
			...base,
			...(bridge === undefined ? {} : { bridge: snapshotPrimitiveBridge(bridge) }),
		});
	}
	return freezeSnapshotRecord(base);
}

function snapshotForeignUsageIR(value: unknown): ForeignUsageIR {
	const kind = nonImportUsageKind(value);
	const base = {
		kind,
		nodeId: ownDataProperty(value, 'nodeId', 'checked Interop usage') as ForeignUsageIR['nodeId'],
		span: snapshotSourceSpan(ownDataProperty(value, 'span', 'checked Interop usage')),
		foreignType: snapshotStableForeignType(ownDataProperty(value, 'foreignType', 'checked Interop usage')),
	};
	if (kind === 'call') {
		const receiverMode = ownOptionalDataProperty(value, 'receiverMode', 'checked Interop usage');
		const mayReject = ownOptionalDataProperty(value, 'mayReject', 'checked Interop usage');
		return freezeSnapshotRecord({
			...base,
			...(receiverMode === undefined ? {} : { receiverMode: receiverMode as NonNullable<ForeignUsageIR['receiverMode']> }),
			...(mayReject === undefined ? {} : { mayReject: mayReject as boolean }),
		});
	}
	if (kind === 'await') {
		const mayReject = ownOptionalDataProperty(value, 'mayReject', 'checked Interop usage');
		return freezeSnapshotRecord({
			...base,
			...(mayReject === undefined ? {} : { mayReject: mayReject as boolean }),
		});
	}
	if (kind === 'bridge') {
		const bridge = ownOptionalDataProperty(value, 'bridge', 'checked Interop usage');
		return freezeSnapshotRecord({
			...base,
			...(bridge === undefined ? {} : { bridge: snapshotPrimitiveBridge(bridge) }),
		});
	}
	return freezeSnapshotRecord(base);
}

function nonImportUsageKind(value: unknown): 'property' | 'call' | 'await' | 'bridge' {
	const kind = ownDataProperty(value, 'kind', 'checked Interop usage');
	if (kind === 'property' || kind === 'call' || kind === 'await' || kind === 'bridge') return kind;
	throw new Error(`checked Interop operation usage has unsupported kind ${String(kind)}`);
}

function snapshotForeignType(value: unknown): ForeignTypeSnapshot {
	const origin = ownOptionalDataProperty(value, 'origin', 'checked foreign type');
	const primitive = ownOptionalDataProperty(value, 'primitive', 'checked foreign type');
	const mustUse = ownOptionalDataProperty(value, 'mustUse', 'checked foreign type');
	return freezeSnapshotRecord({
		ref: snapshotForeignTypeRef(ownDataProperty(value, 'ref', 'checked foreign type')),
		display: ownDataProperty(value, 'display', 'checked foreign type') as string,
		category: ownDataProperty(value, 'category', 'checked foreign type') as ForeignTypeSnapshot['category'],
		...(primitive === undefined ? {} : { primitive: primitive as NonNullable<ForeignTypeSnapshot['primitive']> }),
		...(mustUse === undefined ? {} : { mustUse: mustUse as boolean }),
		...(origin === undefined ? {} : { origin: snapshotOrigin(origin) }),
	});
}

function snapshotStableForeignType(value: unknown): StableForeignTypeSnapshot {
	const origin = ownOptionalDataProperty(value, 'origin', 'checked foreign type');
	const primitive = ownOptionalDataProperty(value, 'primitive', 'checked foreign type');
	const mustUse = ownOptionalDataProperty(value, 'mustUse', 'checked foreign type');
	return freezeSnapshotRecord({
		display: ownDataProperty(value, 'display', 'checked foreign type') as string,
		category: ownDataProperty(value, 'category', 'checked foreign type') as StableForeignTypeSnapshot['category'],
		...(primitive === undefined ? {} : { primitive: primitive as NonNullable<StableForeignTypeSnapshot['primitive']> }),
		...(mustUse === undefined ? {} : { mustUse: mustUse as boolean }),
		...(origin === undefined ? {} : { origin: snapshotOrigin(origin) }),
	});
}

function snapshotForeignTypeRef(value: unknown): ForeignTypeRef {
	return freezeSnapshotRecord({
		providerId: ownDataProperty(value, 'providerId', 'checked foreign type ref') as string,
		generation: ownDataProperty(value, 'generation', 'checked foreign type ref') as number,
		id: ownDataProperty(value, 'id', 'checked foreign type ref') as string,
	});
}

function snapshotOrigin(value: unknown): ForeignOrigin {
	const packageName = ownOptionalDataProperty(value, 'packageName', 'checked foreign origin');
	const packageVersion = ownOptionalDataProperty(value, 'packageVersion', 'checked foreign origin');
	const exportName = ownOptionalDataProperty(value, 'exportName', 'checked foreign origin');
	return freezeSnapshotRecord({
		moduleSpecifier: ownDataProperty(value, 'moduleSpecifier', 'checked foreign origin') as string,
		...(packageName === undefined ? {} : { packageName: packageName as string }),
		...(packageVersion === undefined ? {} : { packageVersion: packageVersion as string }),
		...(exportName === undefined ? {} : { exportName: exportName as string }),
	});
}

function snapshotPrimitiveBridge(value: unknown): PrimitiveBridgePlan {
	return freezeSnapshotRecord({
		kind: ownDataProperty(value, 'kind', 'checked Interop bridge') as PrimitiveBridgePlan['kind'],
		bridge: ownDataProperty(value, 'bridge', 'checked Interop bridge') as PrimitiveBridgePlan['bridge'],
		targetType: ownDataProperty(value, 'targetType', 'checked Interop bridge') as PrimitiveBridgePlan['targetType'],
	});
}

function snapshotModuleWitness(value: unknown): ModuleResolutionWitness {
	const conditionValues = readDenseDataArray(ownDataProperty(value, 'conditions', 'checked module witness'), 'checked module witness conditions');
	const conditions = mapArrayByIndex(conditionValues, condition => {
		if (typeof condition !== 'string') throw new Error('checked module witness condition must be a string');
		return condition;
	});
	const packageName = ownOptionalDataProperty(value, 'packageName', 'checked module witness');
	const packageVersion = ownOptionalDataProperty(value, 'packageVersion', 'checked module witness');
	const runtimeEntry = ownOptionalDataProperty(value, 'runtimeEntry', 'checked module witness');
	const runtimeFormat = ownOptionalDataProperty(value, 'runtimeFormat', 'checked module witness');
	const packageJsonHash = ownOptionalDataProperty(value, 'packageJsonHash', 'checked module witness');
	return freezeSnapshotRecord({
		moduleSpecifier: ownDataProperty(value, 'moduleSpecifier', 'checked module witness') as string,
		...(packageName === undefined ? {} : { packageName: packageName as string }),
		...(packageVersion === undefined ? {} : { packageVersion: packageVersion as string }),
		...(runtimeEntry === undefined ? {} : { runtimeEntry: runtimeEntry as string }),
		...(runtimeFormat === undefined ? {} : { runtimeFormat: runtimeFormat as NonNullable<ModuleResolutionWitness['runtimeFormat']> }),
		conditions: Object.freeze(conditions),
		platform: ownDataProperty(value, 'platform', 'checked module witness') as ModuleResolutionWitness['platform'],
		providerVersion: ownDataProperty(value, 'providerVersion', 'checked module witness') as string,
		...(packageJsonHash === undefined ? {} : { packageJsonHash: packageJsonHash as string }),
	});
}

function snapshotSourceSpan(value: unknown): ForeignUsage['span'] {
	const start = ownDataProperty(value, 'start', 'checked source span');
	const end = ownDataProperty(value, 'end', 'checked source span');
	return freezeSnapshotRecord({
		fileId: ownDataProperty(value, 'fileId', 'checked source span') as ForeignUsage['span']['fileId'],
		start: freezeSnapshotRecord({
			offset: ownDataProperty(start, 'offset', 'checked source position') as number,
			line: ownDataProperty(start, 'line', 'checked source position') as number,
			column: ownDataProperty(start, 'column', 'checked source position') as number,
		}),
		end: freezeSnapshotRecord({
			offset: ownDataProperty(end, 'offset', 'checked source position') as number,
			line: ownDataProperty(end, 'line', 'checked source position') as number,
			column: ownDataProperty(end, 'column', 'checked source position') as number,
		}),
	});
}

function freezeSnapshotRecord<T extends object>(value: T): T {
	const snapshot = Object.create(null) as Record<PropertyKey, unknown>;
	const keys = Reflect.ownKeys(value);
	for (let index = 0; index < keys.length; index++) {
		const key = keys[index]!;
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (descriptor === undefined || !('value' in descriptor)) throw new Error('checked snapshot record must contain only own data fields');
		Object.defineProperty(snapshot, key, {
			configurable: false,
			enumerable: descriptor.enumerable ?? false,
			value: descriptor.value,
			writable: false,
		});
	}
	return Object.freeze(snapshot) as T;
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
	return readDenseOwnDataArray(value, description);
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
		if (Object.getPrototypeOf(value) !== Array.prototype) throw new Error('checked structural array prototype changed');
		const items = readDenseDataArray(value, 'checked structural array');
		let encodedItems = '';
		for (let index = 0; index < items.length; index++) {
			if (index > 0) encodedItems += ',';
			encodedItems += encodeStructuralValue(items[index], seen);
		}
		return `array:${id}:[${encodedItems}]`;
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) throw new Error('checked structural object prototype changed');
	const keys = Reflect.ownKeys(value);
	const stringKeys: string[] = [];
	for (let index = 0; index < keys.length; index++) {
		const key = keys[index]!;
		if (typeof key === 'symbol') throw new Error(`checked structural object contains symbol field ${String(key)}`);
		stringKeys[stringKeys.length] = key;
	}
	const sortedKeys = sortArrayByIndex(stringKeys, compareText);
	let fields = '';
	for (let index = 0; index < sortedKeys.length; index++) {
		const key = sortedKeys[index]!;
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (descriptor === undefined) throw new Error(`checked structural object is missing field ${key}`);
		if (!('value' in descriptor)) throw new Error(`checked structural object field ${key} must be a data property`);
		if (index > 0) fields += ',';
		fields += `${JSON.stringify(key)}=${encodeStructuralValue(descriptor.value, seen)}`;
	}
	return `object:${id}:{${fields}}`;
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
