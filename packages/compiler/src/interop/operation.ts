import type * as A from '../ast/nodes.js';
import type { Diagnostic } from '../diagnostics/diagnostic.js';
import type { NodeId, SourceSpan } from '../source.js';
import type {
	CallableProjectionEvidence,
	ForeignOrigin,
	ForeignUsageIR,
	InteropSemanticModel,
	ModuleResolutionWitness,
	NativeCallableBoundaryDescriptor,
	NativeCallablePrimitiveKind,
	PrimitiveBridgeKind,
	StableForeignTypeSnapshot,
} from './types.js';
import {
	canonicalizeInteropDecision,
	type InteropDecisionIR,
	type InteropSafetyClaim,
} from './decision.js';

export type ExternalOperationKind =
	| 'module-load'
	| 'read-property'
	| 'call'
	| 'await'
	| 'bridge-foreign-primitive';
export type ExternalOperationEffect = 'JavaScript';

export interface ExternalForeignOrigin {
	readonly moduleSpecifier?: string;
	readonly packageName?: string;
	readonly packageVersion?: string;
	readonly exportName?: string;
}

export interface ExternalForeignValueShape {
	readonly category: StableForeignTypeSnapshot['category'];
	readonly primitive?: StableForeignTypeSnapshot['primitive'];
	readonly mustUse?: boolean;
	readonly origin?: ExternalForeignOrigin;
}

export interface ExternalRuntimeResolutionWitness {
	readonly moduleSpecifier: string;
	readonly packageName?: string;
	readonly packageVersion?: string;
	readonly runtimeEntry?: string;
	readonly runtimeFormat?: ModuleResolutionWitness['runtimeFormat'];
	readonly conditions: readonly string[];
	readonly platform: ModuleResolutionWitness['platform'];
	readonly packageJsonHash?: string;
}

export interface ExternalSourcePosition {
	readonly offset: number;
	readonly line: number;
	readonly column: number;
}

export interface ExternalSourceSpan {
	readonly start: ExternalSourcePosition;
	readonly end: ExternalSourcePosition;
}

export interface ExternalCallableProjectionIR {
	readonly argumentIndex: number;
	/** Insertion index in the returned External Operation sequence. Lower indexes execute before the projection; this index and later execute after it. */
	readonly beforeOperationIndex: number;
	readonly descriptor: NativeCallableBoundaryDescriptor;
}

interface ExternalOperationBase {
	readonly kind: ExternalOperationKind;
	readonly nodeId: NodeId;
	readonly span: ExternalSourceSpan;
	readonly decision: InteropDecisionIR;
}

export interface ExternalModuleLoadOperationIR extends ExternalOperationBase {
	readonly kind: 'module-load';
	readonly moduleSpecifier: string;
	readonly runtimeWitness?: ExternalRuntimeResolutionWitness;
}

export interface ExternalReadPropertyOperationIR extends ExternalOperationBase {
	readonly kind: 'read-property';
	readonly effect: ExternalOperationEffect;
	readonly result: ExternalForeignValueShape;
}

export interface ExternalCallOperationIR extends ExternalOperationBase {
	readonly kind: 'call';
	readonly effect: ExternalOperationEffect;
	readonly result: ExternalForeignValueShape;
	readonly receiverMode: 'none' | 'preserve-this';
	readonly mayReject: boolean;
	readonly callableProjections?: readonly ExternalCallableProjectionIR[];
}

export interface ExternalAwaitOperationIR extends ExternalOperationBase {
	readonly kind: 'await';
	readonly effect: ExternalOperationEffect;
	readonly result: ExternalForeignValueShape;
	readonly mayReject: boolean;
}

export interface ExternalBridgeForeignPrimitiveOperationIR extends ExternalOperationBase {
	readonly kind: 'bridge-foreign-primitive';
	readonly source: ExternalForeignValueShape;
	readonly bridge: PrimitiveBridgeKind;
}

export type ExternalOperationIR =
	| ExternalModuleLoadOperationIR
	| ExternalReadPropertyOperationIR
	| ExternalCallOperationIR
	| ExternalAwaitOperationIR
	| ExternalBridgeForeignPrimitiveOperationIR;

const FOREIGN_CATEGORIES: readonly StableForeignTypeSnapshot['category'][] = [
	'primitive', 'literal', 'object', 'function', 'constructor', 'promise', 'array', 'tuple', 'union', 'unknown', 'any',
];
const FOREIGN_PRIMITIVES: readonly NonNullable<StableForeignTypeSnapshot['primitive']>[] = [
	'boolean', 'string', 'number', 'bigint', 'void', 'undefined', 'null',
];
const CALLABLE_PRIMITIVES: readonly NativeCallablePrimitiveKind[] = ['Bool', 'Int', 'Float', 'BigInt', 'String', 'Unit'];
const BRIDGES: readonly PrimitiveBridgeKind[] = ['string', 'bool', 'float', 'bigint', 'unit', 'unknown'];
const RUNTIME_FORMATS: readonly NonNullable<ModuleResolutionWitness['runtimeFormat']>[] = ['esm', 'commonjs', 'builtin', 'bundler', 'unknown'];
const PLATFORMS: readonly ModuleResolutionWitness['platform'][] = ['node', 'browser', 'neutral'];

/**
 * Project one completed checker result into provider-independent External Operations.
 * Experimental entry points register the result before it is exposed to callers. Compiler-owned
 * AST and semantic objects are trusted process state; this function validates only the facts
 * that become stable operation evidence.
 */
export function buildExternalOperationSequence(input: {
	readonly module: A.ModuleNode;
	readonly interop: InteropSemanticModel;
	readonly diagnostics: readonly Diagnostic[];
}): readonly ExternalOperationIR[] {
	if (input.diagnostics.some(diagnostic => diagnostic.severity === 'error')) return Object.freeze([]);

	const operations: ExternalOperationIR[] = [];
	let witnessIndex = 0;
	for (const declaration of input.module.imports) {
		if (declaration.sourceKind !== 'javascript') continue;
		const witnessCount = importResolutionCount(declaration);
		const witnesses = input.interop.moduleWitnesses.slice(witnessIndex, witnessIndex + witnessCount);
		if (witnesses.length !== witnessCount) throw new Error(`External operation evidence is missing module witnesses for ${declaration.source}`);
		witnessIndex += witnessCount;
		if (declaration.typeOnly) continue;
		operations.push(externalModuleLoadOperation({
			nodeId: declaration.id,
			span: declaration.span,
			moduleSpecifier: declaration.source,
			witnesses,
		}));
	}
	if (witnessIndex !== input.interop.moduleWitnesses.length) throw new Error('External operation evidence contains unconsumed module witnesses');

	const callableProjections = groupCallableProjections(input.interop.callableProjections ?? []);
	const operationIndexAtUsageBoundary: number[] = [operations.length];
	for (let usageIndex = 0; usageIndex < input.interop.usageIR.length; usageIndex++) {
		const usage = input.interop.usageIR[usageIndex]!;
		const projections = callableProjections.get(usage.nodeId) ?? [];
		if (usage.kind === 'call' && projections.some(projection => projection.beforeUsageIndex > usageIndex)) {
			throw new Error('External callable projection usage order cannot extend beyond its outer call');
		}
		if (usage.kind !== 'call' && projections.length !== 0) throw new Error('External callable projection evidence must attach to a call usage');
		const stableProjections = usage.kind === 'call'
			? canonicalCallableProjections(projections, usage.nodeId, operationIndexAtUsageBoundary)
			: [];
		const operation = externalOperationFromUsageWithCallables(usage, stableProjections);
		if (operation !== undefined) operations.push(operation);
		operationIndexAtUsageBoundary[usageIndex + 1] = operations.length;
		if (usage.kind === 'call') callableProjections.delete(usage.nodeId);
	}
	if (callableProjections.size !== 0) throw new Error('External callable projection evidence does not correspond to a completed call usage');
	return Object.freeze(operations);
}

/** Import usages are declaration metadata; one ModuleLoad is emitted per runtime import declaration. */
export function externalOperationFromUsage(usage: ForeignUsageIR): ExternalOperationIR | undefined {
	return externalOperationFromUsageWithCallables(usage, []);
}

function externalOperationFromUsageWithCallables(
	usage: ForeignUsageIR,
	callableProjections: readonly ExternalCallableProjectionIR[],
): ExternalOperationIR | undefined {
	if (usage.kind === 'import') {
		if (callableProjections.length !== 0) throw new Error('External callable projection evidence cannot attach to an import usage');
		return undefined;
	}
	if (usage.kind !== 'call' && callableProjections.length !== 0) throw new Error('External callable projection evidence must attach to a call usage');
	const anchor = canonicalOperationAnchor(usage.nodeId, usage.span);
	switch (usage.kind) {
		case 'property':
			return freezeOperation({
				kind: 'read-property',
				...anchor,
				effect: 'JavaScript',
				result: canonicalForeignType(usage.foreignType),
				decision: directDecision(),
			});
		case 'call': {
			if (usage.receiverMode !== 'none' && usage.receiverMode !== 'preserve-this') throw new Error('External Call operation requires a known receiver mode');
			if (typeof usage.mayReject !== 'boolean') throw new Error('External Call operation requires explicit rejection semantics');
			const receiverClaims: readonly InteropSafetyClaim[] = usage.receiverMode === 'preserve-this' ? ['receiver-preserved'] : [];
			return freezeOperation({
				kind: 'call',
				...anchor,
				effect: 'JavaScript',
				result: canonicalForeignType(usage.foreignType),
				receiverMode: usage.receiverMode,
				mayReject: usage.mayReject,
				...(callableProjections.length === 0 ? {} : { callableProjections }),
				decision: callableProjections.length === 0 ? directDecision(receiverClaims) : callableShimDecision(receiverClaims),
			});
		}
		case 'await':
			if (typeof usage.mayReject !== 'boolean') throw new Error('External Await operation requires explicit rejection semantics');
			return freezeOperation({
				kind: 'await',
				...anchor,
				effect: 'JavaScript',
				result: canonicalForeignType(usage.foreignType),
				mayReject: usage.mayReject,
				decision: directDecision(),
			});
		case 'bridge': {
			if (usage.bridge?.kind !== 'primitive') throw new Error('External primitive bridge operation requires an explicit primitive bridge plan');
			assertKnown(BRIDGES, usage.bridge.bridge, 'primitive bridge');
			const source = canonicalForeignType(usage.foreignType);
			assertBridgeMatchesForeignType(usage.bridge.bridge, source);
			return freezeOperation({
				kind: 'bridge-foreign-primitive',
				...anchor,
				source,
				bridge: usage.bridge.bridge,
				decision: usage.bridge.bridge === 'unknown'
					? unresolvedDirectDecision()
					: directDecision(['primitive-bridge-validated']),
			});
		}
	}
	throw new Error(`Unknown Foreign usage kind: ${String((usage as { readonly kind?: unknown }).kind)}`);
}

export function externalModuleLoadOperation(input: {
	readonly nodeId: NodeId;
	readonly span: SourceSpan;
	readonly moduleSpecifier: string;
	readonly witnesses: readonly ModuleResolutionWitness[];
}): ExternalModuleLoadOperationIR {
	const anchor = canonicalOperationAnchor(input.nodeId, input.span);
	const moduleSpecifier = stableProviderText(input.moduleSpecifier, 'module specifier');
	if (input.witnesses.length === 0) {
		return freezeOperation({ kind: 'module-load', ...anchor, moduleSpecifier, decision: unresolvedDirectDecision() });
	}
	const witnesses = input.witnesses.map(witness => canonicalRuntimeWitness(witness, moduleSpecifier));
	const first = witnesses[0]!;
	if (witnesses.some(witness => !sameRuntimeWitness(first, witness))) {
		return freezeOperation({ kind: 'module-load', ...anchor, moduleSpecifier, decision: unresolvedDirectDecision() });
	}
	return freezeOperation({
		kind: 'module-load',
		...anchor,
		moduleSpecifier,
		runtimeWitness: first,
		decision: runtimeResolutionDecision(first),
	});
}

function importResolutionCount(declaration: A.ImportDeclaration): number {
	if (declaration.defaultImport !== undefined || declaration.namespaceImport !== undefined) return 1;
	return Math.max(1, declaration.items.length);
}

function directDecision(claims: readonly InteropSafetyClaim[] = []): InteropDecisionIR {
	return canonicalizeInteropDecision({ status: 'resolved', mechanism: 'direct', authoring: 'none', claims, obligations: [] });
}

function callableShimDecision(claims: readonly InteropSafetyClaim[]): InteropDecisionIR {
	return canonicalizeInteropDecision({
		status: 'resolved',
		mechanism: 'callable-shim',
		authoring: 'generated',
		claims: [...claims, 'type-boundary-safe'],
		obligations: [],
	});
}

function unresolvedDirectDecision(): InteropDecisionIR {
	return canonicalizeInteropDecision({ status: 'unresolved', mechanism: 'direct', authoring: 'none', claims: [], obligations: [] });
}

function runtimeResolutionDecision(witness: ExternalRuntimeResolutionWitness): InteropDecisionIR {
	if ((witness.runtimeFormat === 'esm' || witness.runtimeFormat === 'commonjs' || witness.runtimeFormat === 'builtin') && witness.runtimeEntry !== undefined) {
		return canonicalizeInteropDecision({
			status: 'resolved', mechanism: 'direct', authoring: 'none', claims: [],
			obligations: [{ kind: 'runtime-resolution', stage: 'check', status: 'discharged' }],
		});
	}
	if (witness.runtimeFormat === 'bundler') {
		return canonicalizeInteropDecision({
			status: 'obligation-pending', mechanism: 'direct', authoring: 'none', claims: [],
			obligations: [{ kind: 'runtime-resolution', stage: 'build', status: 'pending' }],
		});
	}
	return unresolvedDirectDecision();
}

function groupCallableProjections(projections: readonly CallableProjectionEvidence[]): Map<NodeId, CallableProjectionEvidence[]> {
	const grouped = new Map<NodeId, CallableProjectionEvidence[]>();
	for (const projection of projections) {
		if (!Number.isSafeInteger(projection.callNodeId)) throw new Error('External callable projection call node id must be a safe integer');
		const current = grouped.get(projection.callNodeId) ?? [];
		current.push(projection);
		grouped.set(projection.callNodeId, current);
	}
	return grouped;
}

function canonicalCallableProjections(
	projections: readonly CallableProjectionEvidence[],
	callNodeId: NodeId,
	operationIndexAtUsageBoundary: readonly number[],
): readonly ExternalCallableProjectionIR[] {
	const seenArguments = new Set<number>();
	const ordered = projections.map(projection => {
		if (projection.callNodeId !== callNodeId) throw new Error('External callable projection is attached to the wrong call node');
		if (!Number.isSafeInteger(projection.argumentIndex) || projection.argumentIndex < 0) throw new Error('External callable projection argument index must be a non-negative safe integer');
		if (!Number.isSafeInteger(projection.beforeUsageIndex) || projection.beforeUsageIndex < 0) throw new Error('External callable projection usage index must be a non-negative safe integer');
		if (seenArguments.has(projection.argumentIndex)) throw new Error('External callable projection argument index must be unique within a call');
		seenArguments.add(projection.argumentIndex);
		const beforeOperationIndex = operationIndexAtUsageBoundary.at(projection.beforeUsageIndex);
		if (typeof beforeOperationIndex !== 'number' || !Number.isSafeInteger(beforeOperationIndex) || beforeOperationIndex < 0) {
			throw new Error('External callable projection usage boundary is not represented in the stable operation sequence');
		}
		return Object.freeze({
			argumentIndex: projection.argumentIndex,
			beforeUsageIndex: projection.beforeUsageIndex,
			beforeOperationIndex,
			descriptor: canonicalCallableDescriptor(projection.descriptor),
		});
	});
	ordered.sort((left, right) => left.argumentIndex - right.argumentIndex);
	for (let index = 1; index < ordered.length; index++) {
		const current = ordered[index]!;
		const previous = ordered[index - 1]!;
		if (current.beforeUsageIndex < previous.beforeUsageIndex || current.beforeOperationIndex < previous.beforeOperationIndex) {
			throw new Error('External callable projection usage order must follow argument evaluation order');
		}
	}
	return Object.freeze(ordered.map(projection => Object.freeze({
		argumentIndex: projection.argumentIndex,
		beforeOperationIndex: projection.beforeOperationIndex,
		descriptor: projection.descriptor,
	})));
}

function canonicalCallableDescriptor(descriptor: NativeCallableBoundaryDescriptor): NativeCallableBoundaryDescriptor {
	if (descriptor.version !== 'virune-callable-shim/v1') throw new Error('Unknown native callable boundary descriptor version');
	if (!Array.isArray(descriptor.parameters)) throw new Error('Native callable boundary parameters must be an array');
	const parameters = descriptor.parameters.map(parameter => {
		assertKnown(CALLABLE_PRIMITIVES, parameter, 'native callable primitive');
		return parameter;
	});
	assertKnown(CALLABLE_PRIMITIVES, descriptor.result, 'native callable result primitive');
	if (typeof descriptor.async !== 'boolean') throw new Error('Native callable boundary async flag must be boolean');
	if (descriptor.contextMode !== 'root-argument') throw new Error('Native callable boundary requires external-root invocation');
	if (!Array.isArray(descriptor.effects)) throw new Error('Native callable boundary effects must be an array');
	const effects = descriptor.effects.map(effect => stableProviderText(effect, 'native callable effect'));
	if (effects.includes('*')) throw new Error('Open effects cannot become stable native callable boundary evidence');
	const canonicalEffects = [...new Set(effects)].sort(compareText);
	if (canonicalEffects.length !== effects.length || canonicalEffects.some((effect, index) => effect !== effects[index])) throw new Error('Native callable boundary effects must be unique and canonically ordered');
	return Object.freeze({
		version: 'virune-callable-shim/v1',
		parameters: Object.freeze(parameters),
		result: descriptor.result,
		async: descriptor.async,
		effects: Object.freeze(canonicalEffects),
		contextMode: 'root-argument',
	});
}

function canonicalForeignType(snapshot: StableForeignTypeSnapshot): ExternalForeignValueShape {
	assertKnown(FOREIGN_CATEGORIES, snapshot.category, 'foreign type category');
	if (snapshot.category === 'any') throw new Error('TypeScript any cannot become successful External operation evidence');
	if (snapshot.primitive !== undefined) {
		assertKnown(FOREIGN_PRIMITIVES, snapshot.primitive, 'foreign primitive');
		if (snapshot.category !== 'primitive' && snapshot.category !== 'literal') {
			throw new Error(`External operation foreign primitive is incompatible with category ${snapshot.category}`);
		}
	} else if (snapshot.category === 'primitive') {
		throw new Error('External operation primitive category requires an explicit primitive kind');
	}
	if (snapshot.mustUse !== undefined && typeof snapshot.mustUse !== 'boolean') throw new Error('External operation foreign mustUse must be boolean');
	const origin = snapshot.origin === undefined ? undefined : canonicalOrigin(snapshot.origin);
	return Object.freeze({
		category: snapshot.category,
		...(snapshot.primitive === undefined ? {} : { primitive: snapshot.primitive }),
		...(snapshot.mustUse === undefined ? {} : { mustUse: snapshot.mustUse }),
		...(origin === undefined ? {} : { origin }),
	});
}

function canonicalOrigin(origin: ForeignOrigin): ExternalForeignOrigin | undefined {
	const moduleSpecifier = stableOptionalOriginText(origin.moduleSpecifier);
	const packageName = stableOptionalOriginText(origin.packageName);
	const packageVersion = stableOptionalOriginText(origin.packageVersion);
	const exportName = stableOptionalOriginText(origin.exportName);
	if (moduleSpecifier === undefined && packageName === undefined && packageVersion === undefined && exportName === undefined) return undefined;
	return Object.freeze({
		...(moduleSpecifier === undefined ? {} : { moduleSpecifier }),
		...(packageName === undefined ? {} : { packageName }),
		...(packageVersion === undefined ? {} : { packageVersion }),
		...(exportName === undefined ? {} : { exportName }),
	});
}

function canonicalRuntimeWitness(witness: ModuleResolutionWitness, moduleSpecifier: string): ExternalRuntimeResolutionWitness {
	if (witness.moduleSpecifier !== moduleSpecifier) throw new Error('External ModuleLoad witness must resolve the same module specifier');
	assertKnown(PLATFORMS, witness.platform, 'module witness platform');
	if (witness.runtimeFormat !== undefined) assertKnown(RUNTIME_FORMATS, witness.runtimeFormat, 'module witness runtime format');
	if (!Array.isArray(witness.conditions)) throw new Error('External module witness conditions must be an array');
	const conditionValues: readonly string[] = witness.conditions;
	const conditions: readonly string[] = Object.freeze([...new Set(conditionValues.map((condition: string) => stableProviderText(condition, 'module witness condition')))].sort(compareText));
	const runtimeEntry = witness.runtimeEntry === undefined ? undefined : canonicalRuntimeEntry(witness.runtimeEntry);
	assertRuntimeResolutionCoherence(moduleSpecifier, runtimeEntry, witness.runtimeFormat, witness.platform);
	return Object.freeze({
		moduleSpecifier,
		...(witness.packageName === undefined ? {} : { packageName: stableProviderText(witness.packageName, 'runtime package name') }),
		...(witness.packageVersion === undefined ? {} : { packageVersion: stableProviderText(witness.packageVersion, 'runtime package version') }),
		...(runtimeEntry === undefined ? {} : { runtimeEntry }),
		...(witness.runtimeFormat === undefined ? {} : { runtimeFormat: witness.runtimeFormat }),
		conditions,
		platform: witness.platform,
		...(witness.packageJsonHash === undefined ? {} : { packageJsonHash: canonicalHash(witness.packageJsonHash, 'runtime package.json hash') }),
	});
}

function sameRuntimeWitness(left: ExternalRuntimeResolutionWitness, right: ExternalRuntimeResolutionWitness): boolean {
	return left.moduleSpecifier === right.moduleSpecifier
		&& left.packageName === right.packageName
		&& left.packageVersion === right.packageVersion
		&& left.runtimeEntry === right.runtimeEntry
		&& left.runtimeFormat === right.runtimeFormat
		&& left.platform === right.platform
		&& left.packageJsonHash === right.packageJsonHash
		&& left.conditions.length === right.conditions.length
		&& left.conditions.every((condition, index) => condition === right.conditions[index]);
}

function assertBridgeMatchesForeignType(bridge: PrimitiveBridgeKind, source: ExternalForeignValueShape): void {
	const matches = bridge === 'string' ? source.primitive === 'string'
		: bridge === 'bool' ? source.primitive === 'boolean'
			: bridge === 'float' ? source.primitive === 'number'
				: bridge === 'bigint' ? source.primitive === 'bigint'
					: bridge === 'unit' ? source.primitive === 'void'
						: source.category === 'unknown';
	if (!matches) throw new Error('External primitive bridge evidence disagrees with foreign source facts');
}

function canonicalOperationAnchor(nodeId: NodeId, span: SourceSpan): { readonly nodeId: NodeId; readonly span: ExternalSourceSpan } {
	if (!Number.isSafeInteger(nodeId)) throw new Error('External operation node id must be a safe integer');
	return { nodeId, span: canonicalStableSourceSpan(span) };
}

function canonicalStableSourceSpan(span: SourceSpan): ExternalSourceSpan {
	return Object.freeze({ start: canonicalPosition(span.start), end: canonicalPosition(span.end) });
}

function canonicalPosition(position: SourceSpan['start']): ExternalSourcePosition {
	if (!Number.isSafeInteger(position.offset) || position.offset < 0
		|| !Number.isSafeInteger(position.line) || position.line < 1
		|| !Number.isSafeInteger(position.column) || position.column < 1) {
		throw new Error('External operation source span must contain valid integer positions');
	}
	return Object.freeze({ offset: position.offset, line: position.line, column: position.column });
}

function canonicalRuntimeEntry(value: string): string {
	stableProviderText(value, 'runtime entry');
	if (value.includes('\\') || value.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(value) || /^file:/iu.test(value)) {
		throw new Error('External operation runtime entry must not contain an absolute or provider-private path');
	}
	const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/u.exec(value)?.[1];
	if (scheme !== undefined) {
		if (scheme !== 'node') throw new Error(`External operation runtime entry uses unsupported scheme ${scheme}`);
		const builtinSegments = value.slice('node:'.length).split('/');
		if (builtinSegments.some(segment => segment.length === 0 || segment === '.' || segment === '..')) {
			throw new Error('External operation runtime entry must be a canonical node builtin locator');
		}
		return value;
	}
	const segments = value.split('/');
	if (segments.some(segment => segment.length === 0 || segment === '.' || segment === '..')) {
		throw new Error('External operation runtime entry must be a canonical relative locator');
	}
	return value;
}

function assertRuntimeResolutionCoherence(
	moduleSpecifier: string,
	runtimeEntry: string | undefined,
	runtimeFormat: ModuleResolutionWitness['runtimeFormat'] | undefined,
	platform: ModuleResolutionWitness['platform'],
): void {
	const nodeBuiltinEntry = runtimeEntry?.startsWith('node:') ?? false;
	const successfulRuntimeFormat = runtimeFormat === 'esm' || runtimeFormat === 'commonjs' || runtimeFormat === 'builtin';
	if (runtimeFormat === 'commonjs' && platform !== 'node') {
		throw new Error('External operation CommonJS runtime format requires the node platform');
	}
	if (moduleSpecifier.startsWith('node:') && runtimeEntry !== undefined && successfulRuntimeFormat
		&& (runtimeFormat !== 'builtin' || platform !== 'node' || runtimeEntry !== moduleSpecifier)) {
		throw new Error('External operation node: module specifier requires matching builtin runtime evidence');
	}
	if (nodeBuiltinEntry && (runtimeFormat !== 'builtin' || platform !== 'node')) {
		throw new Error('External operation node builtin runtime entry requires builtin format on the node platform');
	}
	if (runtimeFormat === 'builtin' && runtimeEntry !== undefined) {
		if (!nodeBuiltinEntry) throw new Error('External operation builtin runtime format requires a node builtin runtime entry');
		const expectedRuntimeEntry = moduleSpecifier.startsWith('node:') ? moduleSpecifier : `node:${moduleSpecifier}`;
		if (runtimeEntry !== expectedRuntimeEntry) {
			throw new Error('External operation builtin runtime entry must match the imported module specifier');
		}
	}
}

function stableOptionalOriginText(value: string | undefined): string | undefined {
	if (value === undefined || value.length === 0 || /\p{Cc}/u.test(value)) return undefined;
	if (value.includes('\\') || value.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(value) || /^file:/iu.test(value)) return undefined;
	return value;
}

function stableProviderText(value: string, description: string): string {
	if (typeof value !== 'string' || value.length === 0) throw new Error(`External operation ${description} must be a non-empty string`);
	if (/\p{Cc}/u.test(value)) throw new Error(`External operation ${description} must not contain control characters`);
	if (value.includes('\\') || value.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(value) || /^file:/iu.test(value)) {
		throw new Error(`External operation ${description} must not contain an absolute or provider-private path`);
	}
	return value;
}

function canonicalHash(value: string, description: string): string {
	if (!/^[0-9a-f]{64}$/u.test(value)) throw new Error(`External operation ${description} must be a lowercase SHA-256 digest`);
	return value;
}

function freezeOperation<T extends ExternalOperationIR>(operation: T): T {
	return Object.freeze(operation);
}

function assertKnown<T extends string>(known: readonly T[], value: unknown, description: string): asserts value is T {
	if (!known.includes(value as T)) throw new Error(`Unknown ${description}: ${String(value)}`);
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
