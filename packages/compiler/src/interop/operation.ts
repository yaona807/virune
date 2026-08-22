import type * as A from '../ast/nodes.js';
import type { Diagnostic } from '../diagnostics/diagnostic.js';
import type { NodeId, SourceSpan } from '../source.js';
import {
	filterArrayByIndex,
	mapArrayByIndex,
	readDenseOwnDataArray,
	sliceArrayByIndex,
	someArrayByIndex,
	sortArrayByIndex,
	uniqueArrayByIndex,
} from './array-safety.js';
import type {
	ForeignOrigin,
	ForeignUsage,
	ForeignUsageIR,
	InteropSemanticModel,
	ModuleResolutionWitness,
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

export interface ExternalSourceSpan {
	readonly start: SourceSpan['start'];
	readonly end: SourceSpan['end'];
}

interface ExternalOperationBase {
	readonly kind: ExternalOperationKind;
	readonly nodeId: NodeId;
	readonly span: ExternalSourceSpan;
	readonly decision: InteropDecisionIR;
}

interface AstNodeAnchor {
	readonly kind: string;
	readonly span: SourceSpan;
	readonly foreignCall?: true;
	readonly foreignBridge?: PrimitiveBridgeKind;
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

const FOREIGN_CATEGORIES = new Set<StableForeignTypeSnapshot['category']>([
	'primitive', 'literal', 'object', 'function', 'constructor', 'promise', 'array', 'tuple', 'union', 'unknown', 'any',
]);
const FOREIGN_PRIMITIVES = new Set<NonNullable<StableForeignTypeSnapshot['primitive']>>([
	'boolean', 'string', 'number', 'bigint', 'void', 'undefined', 'null',
]);
const BRIDGES = new Set<PrimitiveBridgeKind>(['string', 'bool', 'float', 'bigint', 'unit', 'unknown']);
const RUNTIME_FORMATS = new Set<NonNullable<ModuleResolutionWitness['runtimeFormat']>>([
	'esm', 'commonjs', 'builtin', 'bundler', 'unknown',
]);
const PLATFORMS = new Set<ModuleResolutionWitness['platform']>(['node', 'browser', 'neutral']);

/**
 * Build provider-independent External Operations from the compiler's existing
 * semantic model. The checker remains the single interpreter of provider
 * results; this function only canonicalizes already-recorded semantic facts.
 *
 * Successful Direct operation evidence is intentionally withheld when the
 * compilation has errors. Existing ForeignUsage records may be populated
 * before a later failure is discovered, so exposing them as resolved operation
 * evidence from an invalid module would create a false-safe boundary.
 */
export function externalOperationSequence(input: {
	readonly module: A.ModuleNode;
	readonly interop: InteropSemanticModel;
	readonly diagnostics: readonly Diagnostic[];
}): readonly ExternalOperationIR[] {
	if (someArrayByIndex(input.diagnostics, diagnostic => diagnostic.severity === 'error')) return [];

	assertCurrentCheckerUsageCoverage(input.interop.usageIR, input.interop.usages);
	const nodeAnchors = collectAstNodeAnchors(input.module);
	for (let index = 0; index < input.interop.usageIR.length; index++) {
		assertCurrentUsageAnchor(input.interop.usageIR[index]!, nodeAnchors, input.interop.usages);
	}

	const operations: ExternalOperationIR[] = [];
	let witnessIndex = 0;
	let runtimeImportDeclarations = 0;
	for (let importIndex = 0; importIndex < input.module.imports.length; importIndex++) {
		const declaration = input.module.imports[importIndex]!;
		if (declaration.sourceKind !== 'javascript') continue;
		const witnessCount = importResolutionCount(declaration);
		const witnesses = sliceArrayByIndex(input.interop.moduleWitnesses, witnessIndex, witnessIndex + witnessCount);
		if (witnesses.length !== witnessCount) throw new Error(`External operation evidence is missing module witnesses for ${declaration.source}`);
		witnessIndex += witnessCount;
		if (declaration.typeOnly) continue;
		runtimeImportDeclarations++;
		operations[operations.length] = externalModuleLoadOperation({
			nodeId: declaration.id,
			span: declaration.span,
			moduleSpecifier: declaration.source,
			witnesses,
		});
	}
	if (witnessIndex !== input.interop.moduleWitnesses.length) throw new Error('External operation evidence contains unconsumed module witnesses');
	if (input.interop.requiresJavaScriptInitialization !== (runtimeImportDeclarations > 0)) {
		throw new Error('External operation JavaScript initialization state disagrees with source import semantics');
	}

	for (let index = 0; index < input.interop.usageIR.length; index++) {
		const operation = externalOperationFromUsage(input.interop.usageIR[index]!);
		if (operation !== undefined) operations[operations.length] = operation;
	}
	return operations;
}

/**
 * Convert one already-accepted non-import Foreign usage to provider-independent
 * operation evidence. Import usages intentionally return undefined: runtime
 * ModuleLoad semantics belong to the import declaration, because a type-only
 * import has no runtime load while a side-effect import has no bound value.
 */
export function externalOperationFromUsage(usage: ForeignUsageIR): ExternalOperationIR | undefined {
	const anchor = canonicalOperationAnchor(usage.nodeId, usage.span);
	switch (usage.kind) {
		case 'import': return undefined;
		case 'property':
			return {
				kind: 'read-property',
				...anchor,
				effect: 'JavaScript',
				result: canonicalForeignType(usage.foreignType),
				decision: directDecision(),
			};
		case 'call': {
			const receiverMode = usage.receiverMode;
			if (receiverMode !== 'none' && receiverMode !== 'preserve-this') throw new Error('External Call operation requires a known receiver mode');
			if (typeof usage.mayReject !== 'boolean') throw new Error('External Call operation requires explicit rejection semantics');
			return {
				kind: 'call',
				...anchor,
				effect: 'JavaScript',
				result: canonicalForeignType(usage.foreignType),
				receiverMode,
				mayReject: usage.mayReject,
				decision: directDecision(receiverMode === 'preserve-this' ? ['receiver-preserved'] : []),
			};
		}
		case 'await':
			if (typeof usage.mayReject !== 'boolean') throw new Error('External Await operation requires explicit rejection semantics');
			return {
				kind: 'await',
				...anchor,
				effect: 'JavaScript',
				result: canonicalForeignType(usage.foreignType),
				mayReject: usage.mayReject,
				decision: directDecision(),
			};
		case 'bridge': {
			if (usage.bridge?.kind !== 'primitive') throw new Error('External primitive bridge operation requires an explicit primitive bridge plan');
			assertKnown(BRIDGES, usage.bridge.bridge, 'primitive bridge');
			const source = canonicalForeignType(usage.foreignType);
			assertBridgeMatchesForeignType(usage.bridge.bridge, source);
			return {
				kind: 'bridge-foreign-primitive',
				...anchor,
				source,
				bridge: usage.bridge.bridge,
				decision: directDecision(usage.bridge.bridge === 'unknown' ? [] : ['primitive-bridge-validated']),
			};
		}
	}
	throw new Error(`Unknown Foreign usage kind: ${String((usage as { readonly kind?: unknown }).kind)}`);
}

/** Runtime ModuleLoad is built explicitly from declaration-level semantics. */
export function externalModuleLoadOperation(input: {
	readonly nodeId: NodeId;
	readonly span: SourceSpan;
	readonly moduleSpecifier: string;
	readonly witnesses: readonly ModuleResolutionWitness[];
}): ExternalModuleLoadOperationIR {
	const anchor = canonicalOperationAnchor(input.nodeId, input.span);
	const moduleSpecifier = sourceModuleSpecifier(input.moduleSpecifier, 'ModuleLoad module specifier');
	if (input.witnesses.length === 0) {
		return shadowMissingOwnFields({
			kind: 'module-load',
			...anchor,
			moduleSpecifier,
			decision: unresolvedDirectDecision(),
		}, ['runtimeWitness']);
	}
	const witnesses = mapArrayByIndex(input.witnesses, witness => canonicalRuntimeWitness(witness, moduleSpecifier));
	const first = witnesses[0]!;
	if (someArrayByIndex(witnesses, witness => !sameRuntimeWitness(first, witness))) {
		return shadowMissingOwnFields({
			kind: 'module-load',
			...anchor,
			moduleSpecifier,
			decision: unresolvedDirectDecision(),
		}, ['runtimeWitness']);
	}
	return {
		kind: 'module-load',
		...anchor,
		moduleSpecifier,
		runtimeWitness: first,
		decision: runtimeResolutionDecision(first),
	};
}

function importResolutionCount(declaration: A.ImportDeclaration): number {
	if (declaration.defaultImport !== undefined || declaration.namespaceImport !== undefined) return 1;
	return Math.max(1, declaration.items.length);
}

function directDecision(claims: readonly InteropSafetyClaim[] = []): InteropDecisionIR {
	return canonicalizeInteropDecision({
		status: 'resolved',
		mechanism: 'direct',
		authoring: 'none',
		claims,
		obligations: [],
	});
}

function unresolvedDirectDecision(): InteropDecisionIR {
	return canonicalizeInteropDecision({
		status: 'unresolved',
		mechanism: 'direct',
		authoring: 'none',
		claims: [],
		obligations: [],
	});
}

function runtimeResolutionDecision(witness: ExternalRuntimeResolutionWitness): InteropDecisionIR {
	if (
		(witness.runtimeFormat === 'esm' || witness.runtimeFormat === 'commonjs' || witness.runtimeFormat === 'builtin')
		&& witness.runtimeEntry !== undefined
	) {
		return canonicalizeInteropDecision({
			status: 'resolved',
			mechanism: 'direct',
			authoring: 'none',
			claims: [],
			obligations: [{ kind: 'runtime-resolution', stage: 'check', status: 'discharged' }],
		});
	}
	if (witness.runtimeFormat === 'bundler') {
		return canonicalizeInteropDecision({
			status: 'obligation-pending',
			mechanism: 'direct',
			authoring: 'none',
			claims: [],
			obligations: [{ kind: 'runtime-resolution', stage: 'build', status: 'pending' }],
		});
	}
	return unresolvedDirectDecision();
}

function canonicalForeignType(snapshot: StableForeignTypeSnapshot): ExternalForeignValueShape {
	assertKnown(FOREIGN_CATEGORIES, snapshot.category, 'foreign type category');
	if (snapshot.primitive !== undefined) assertKnown(FOREIGN_PRIMITIVES, snapshot.primitive, 'foreign primitive');
	if (snapshot.mustUse !== undefined && typeof snapshot.mustUse !== 'boolean') throw new Error('External operation foreign mustUse must be boolean');
	return shadowMissingOwnFields({
		category: snapshot.category,
		...(snapshot.primitive === undefined ? {} : { primitive: snapshot.primitive }),
		...(snapshot.mustUse === undefined ? {} : { mustUse: snapshot.mustUse }),
		...(snapshot.origin === undefined ? {} : { origin: canonicalOrigin(snapshot.origin) }),
	}, ['primitive', 'mustUse', 'origin']);
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

function canonicalOrigin(origin: ForeignOrigin): ExternalForeignOrigin {
	const moduleSpecifier = canonicalOptionalOriginText(origin.moduleSpecifier, 'origin module specifier');
	const packageName = origin.packageName === undefined ? undefined : canonicalOptionalOriginText(origin.packageName, 'origin package name');
	const packageVersion = origin.packageVersion === undefined ? undefined : canonicalOptionalOriginText(origin.packageVersion, 'origin package version');
	const exportName = origin.exportName === undefined ? undefined : canonicalOptionalOriginText(origin.exportName, 'origin export name');
	return shadowMissingOwnFields({
		...(moduleSpecifier === undefined ? {} : { moduleSpecifier }),
		...(packageName === undefined ? {} : { packageName }),
		...(packageVersion === undefined ? {} : { packageVersion }),
		...(exportName === undefined ? {} : { exportName }),
	}, ['moduleSpecifier', 'packageName', 'packageVersion', 'exportName']);
}

function canonicalRuntimeWitness(witness: ModuleResolutionWitness, moduleSpecifier: string): ExternalRuntimeResolutionWitness {
	if (witness.moduleSpecifier !== moduleSpecifier) throw new Error('External ModuleLoad witness must resolve the same module specifier');
	assertKnown(PLATFORMS, witness.platform, 'module witness platform');
	if (witness.runtimeFormat !== undefined) assertKnown(RUNTIME_FORMATS, witness.runtimeFormat, 'module witness runtime format');
	const validatedConditions = mapArrayByIndex(witness.conditions, condition => canonicalProviderText(condition, 'module witness condition'));
	const conditions = sortArrayByIndex(uniqueArrayByIndex(validatedConditions), compareText);
	return shadowMissingOwnFields({
		moduleSpecifier,
		...(witness.packageName === undefined ? {} : { packageName: canonicalProviderText(witness.packageName, 'runtime package name') }),
		...(witness.packageVersion === undefined ? {} : { packageVersion: canonicalProviderText(witness.packageVersion, 'runtime package version') }),
		...(witness.runtimeEntry === undefined ? {} : { runtimeEntry: canonicalRuntimeEntry(witness.runtimeEntry) }),
		...(witness.runtimeFormat === undefined ? {} : { runtimeFormat: witness.runtimeFormat }),
		conditions,
		platform: witness.platform,
		...(witness.packageJsonHash === undefined ? {} : { packageJsonHash: canonicalHash(witness.packageJsonHash, 'runtime package.json hash') }),
	}, ['packageName', 'packageVersion', 'runtimeEntry', 'runtimeFormat', 'packageJsonHash']);
}

function sameRuntimeWitness(left: ExternalRuntimeResolutionWitness, right: ExternalRuntimeResolutionWitness): boolean {
	if (
		left.moduleSpecifier !== right.moduleSpecifier
		|| left.packageName !== right.packageName
		|| left.packageVersion !== right.packageVersion
		|| left.runtimeEntry !== right.runtimeEntry
		|| left.runtimeFormat !== right.runtimeFormat
		|| left.platform !== right.platform
		|| left.packageJsonHash !== right.packageJsonHash
		|| left.conditions.length !== right.conditions.length
	) return false;
	for (let index = 0; index < left.conditions.length; index++) {
		if (left.conditions[index] !== right.conditions[index]) return false;
	}
	return true;
}

function collectAstNodeAnchors(module: A.ModuleNode): ReadonlyMap<NodeId, AstNodeAnchor> {
	const result = new Map<NodeId, AstNodeAnchor>();
	const seen = new Set<object>();
	const visit = (value: unknown): void => {
		if (value === null || typeof value !== 'object') return;
		if (seen.has(value)) return;
		seen.add(value);
		if (Array.isArray(value)) {
			const items = readDenseOwnDataArray(value, 'checked AST array');
			for (let index = 0; index < items.length; index++) visit(items[index]);
			return;
		}
		const record = value as Record<string, unknown>;
		if (isNodeId(record.id) && typeof record.kind === 'string' && isSourceSpan(record.span)) {
			if (result.has(record.id as NodeId)) throw new Error(`Duplicate AST node id ${record.id} in External operation source binding`);
			const foreignBridge = typeof record.foreignBridge === 'string' && BRIDGES.has(record.foreignBridge as PrimitiveBridgeKind)
				? record.foreignBridge as PrimitiveBridgeKind
				: undefined;
			result.set(record.id as NodeId, {
				kind: record.kind,
				span: canonicalSourceSpan(record.span),
				...(record.foreignCall === true ? { foreignCall: true as const } : {}),
				...(foreignBridge === undefined ? {} : { foreignBridge }),
			});
		}
		const keys = Reflect.ownKeys(record);
		for (let index = 0; index < keys.length; index++) {
			const key = keys[index]!;
			if (typeof key === 'symbol') throw new Error(`External operation AST contains symbol field ${String(key)}`);
			const descriptor = Object.getOwnPropertyDescriptor(record, key);
			if (descriptor === undefined || !('value' in descriptor)) throw new Error(`External operation AST field ${key} must be a data property`);
			visit(descriptor.value);
		}
	};
	visit(module);
	return result;
}

function assertCurrentCheckerUsageCoverage(stableUsages: readonly ForeignUsageIR[], currentUsages: readonly ForeignUsage[]): void {
	const stable = filterArrayByIndex(stableUsages, usage => usage.kind !== 'import');
	const current = filterArrayByIndex(currentUsages, usage => usage.kind !== 'import');
	if (stable.length !== current.length) throw new Error('Stale or cross-session External usage evidence: current checker usage coverage is incomplete');
	const stableKeys = mapArrayByIndex(stable, nonImportUsageAnchorKey);
	const currentKeys = mapArrayByIndex(current, nonImportUsageAnchorKey);
	if (uniqueArrayByIndex(stableKeys).length !== stable.length || uniqueArrayByIndex(currentKeys).length !== current.length) {
		throw new Error('Stale or cross-session External usage evidence: duplicate current usage anchor');
	}
	for (let index = 0; index < stableKeys.length; index++) {
		if (stableKeys[index] !== currentKeys[index]) {
			throw new Error('Stale or cross-session External usage evidence: current checker usage order disagrees');
		}
	}
}

function nonImportUsageAnchorKey(usage: ForeignUsage | ForeignUsageIR): string {
	if (usage.kind === 'import' || !isNodeId(usage.nodeId) || !isSourceSpan(usage.span)) {
		throw new Error('Stale or cross-session External usage evidence: malformed current usage anchor');
	}
	return `${usage.kind}\0${usage.nodeId}\0${usage.span.fileId}\0${usage.span.start.offset}\0${usage.span.start.line}\0${usage.span.start.column}\0${usage.span.end.offset}\0${usage.span.end.line}\0${usage.span.end.column}`;
}

function assertCurrentUsageAnchor(
	usage: ForeignUsageIR,
	nodeAnchors: ReadonlyMap<NodeId, AstNodeAnchor>,
	currentUsages: readonly ForeignUsage[],
): void {
	const current = nodeAnchors.get(usage.nodeId);
	if (
		current === undefined
		|| !isSourceSpan(usage.span)
		|| !sameSpan(current.span, usage.span)
		|| !usageMatchesAstAnchor(usage, current)
		|| !usageMatchesCurrentCheckerEvidence(usage, currentUsages)
	) {
		throw new Error(`Stale or cross-session External usage evidence for node ${usage.nodeId}`);
	}
}

function usageMatchesCurrentCheckerEvidence(usage: ForeignUsageIR, currentUsages: readonly ForeignUsage[]): boolean {
	if (usage.kind === 'import') return true;
	const candidates = filterArrayByIndex(currentUsages, candidate => candidate.kind === usage.kind
		&& candidate.nodeId === usage.nodeId
		&& isSourceSpan(candidate.span)
		&& sameSpan(candidate.span, usage.span));
	if (candidates.length !== 1) return false;
	const current = candidates[0]!;
	try {
		if (!sameForeignValueShape(canonicalForeignType(current.foreignType), canonicalForeignType(usage.foreignType))) return false;
	} catch {
		return false;
	}
	switch (usage.kind) {
		case 'property': return true;
		case 'call': return current.receiverMode === usage.receiverMode && current.mayReject === usage.mayReject;
		case 'await': return current.mayReject === usage.mayReject;
		case 'bridge':
			return current.bridge?.kind === 'primitive'
				&& usage.bridge?.kind === 'primitive'
				&& current.bridge.bridge === usage.bridge.bridge;
	}
	return false;
}

function sameForeignValueShape(left: ExternalForeignValueShape, right: ExternalForeignValueShape): boolean {
	return left.category === right.category
		&& left.primitive === right.primitive
		&& left.mustUse === right.mustUse
		&& sameForeignOrigin(left.origin, right.origin);
}

function sameForeignOrigin(left: ExternalForeignOrigin | undefined, right: ExternalForeignOrigin | undefined): boolean {
	if (left === undefined || right === undefined) return left === right;
	return left.moduleSpecifier === right.moduleSpecifier
		&& left.packageName === right.packageName
		&& left.packageVersion === right.packageVersion
		&& left.exportName === right.exportName;
}

function usageMatchesAstAnchor(usage: ForeignUsageIR, anchor: AstNodeAnchor): boolean {
	switch (usage.kind) {
		case 'import': return anchor.kind === 'ImportDeclaration';
		case 'property': return anchor.kind === 'FieldExpression';
		case 'call': return anchor.kind === 'CallExpression' && anchor.foreignCall === true;
		case 'await': return anchor.kind === 'AwaitExpression';
		case 'bridge': return anchor.kind.endsWith('Expression') && usage.bridge?.kind === 'primitive' && anchor.foreignBridge === usage.bridge.bridge;
	}
	return false;
}

function canonicalOperationAnchor(nodeId: NodeId, span: SourceSpan): { readonly nodeId: NodeId; readonly span: ExternalSourceSpan } {
	if (!isNodeId(nodeId)) throw new Error('External operation node id must be a safe integer');
	return { nodeId, span: canonicalStableSourceSpan(span) };
}

function canonicalStableSourceSpan(span: SourceSpan): ExternalSourceSpan {
	const canonical = canonicalSourceSpan(span);
	return {
		start: canonical.start,
		end: canonical.end,
	};
}

function canonicalSourceSpan(span: SourceSpan): SourceSpan {
	if (!isSourceSpan(span)) throw new Error('External operation source span must contain safe integer positions');
	return {
		fileId: span.fileId,
		start: { offset: span.start.offset, line: span.start.line, column: span.start.column },
		end: { offset: span.end.offset, line: span.end.line, column: span.end.column },
	};
}

function isNodeId(value: unknown): value is NodeId {
	return typeof value === 'number' && Number.isSafeInteger(value);
}

function isSourceSpan(value: unknown): value is SourceSpan {
	if (value === null || typeof value !== 'object') return false;
	const span = value as Partial<SourceSpan>;
	return isNodeId(span.fileId) && isSourcePosition(span.start) && isSourcePosition(span.end);
}

function isSourcePosition(value: unknown): value is SourceSpan['start'] {
	if (value === null || typeof value !== 'object') return false;
	const position = value as Partial<SourceSpan['start']>;
	return isNodeId(position.offset) && isNodeId(position.line) && isNodeId(position.column);
}

function sameSpan(left: SourceSpan, right: SourceSpan): boolean {
	return left.fileId === right.fileId
		&& left.start.offset === right.start.offset
		&& left.start.line === right.start.line
		&& left.start.column === right.start.column
		&& left.end.offset === right.end.offset
		&& left.end.line === right.end.line
		&& left.end.column === right.end.column;
}

function canonicalRuntimeEntry(value: string): string {
	canonicalStableText(value, 'runtime entry');
	if (value.includes('\\')) throw new Error('External operation runtime entry must use canonical forward slashes');
	if (value.startsWith('/') || /^file:/iu.test(value) || /^[A-Za-z]:/u.test(value)) {
		throw new Error('External operation runtime entry must not be absolute or drive-relative');
	}
	if (/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(value)) {
		if (containsProviderPrivatePathSyntax(value)) {
			throw new Error('External operation runtime entry must not contain provider-private path syntax');
		}
		return value;
	}
	return canonicalRelativeLocator(value, 'runtime entry');
}

function sourceModuleSpecifier(value: string, description: string): string {
	if (typeof value !== 'string') throw new Error(`External operation ${description} must be a string`);
	return value;
}

function canonicalOptionalOriginText(value: string, description: string): string | undefined {
	if (typeof value !== 'string') throw new Error(`External operation ${description} must be a string`);
	if (value.length === 0 || /\p{Cc}/u.test(value)) return undefined;
	if (containsProviderPrivatePathSyntax(value)) return undefined;
	return value;
}

function canonicalProviderText(value: string, description: string): string {
	canonicalStableText(value, description);
	if (containsProviderPrivatePathSyntax(value)) {
		throw new Error(`External operation ${description} must not contain provider-private path syntax`);
	}
	return value;
}

function canonicalStableText(value: string, description: string): string {
	if (typeof value !== 'string' || value.length === 0) throw new Error(`External operation ${description} must be a non-empty string`);
	if (/\p{Cc}/u.test(value)) throw new Error(`External operation ${description} must not contain control characters`);
	return value;
}

function canonicalRelativeLocator(value: string, description: string): string {
	canonicalStableText(value, description);
	if (value.includes('\\')) throw new Error(`External operation ${description} must use canonical forward slashes`);
	if (containsProviderPrivatePathSyntax(value)) throw new Error(`External operation ${description} must not be absolute or drive-relative`);
	const segments = value.split('/');
	if (someArrayByIndex(segments, segment => segment.length === 0 || segment === '.' || segment === '..')) {
		throw new Error(`External operation ${description} must be a canonical relative locator`);
	}
	return value;
}

function containsProviderPrivatePathSyntax(value: string): boolean {
	if (value.includes('\\')) return true;
	if (/(?:^|[^\p{L}\p{N}._~%+/:-])\/{2,}/u.test(value)) return true;
	return /(?:^|[^\p{L}\p{N}._~%+/-])(?:file:|[A-Za-z]:|\/(?!\/))/iu.test(value);
}

function canonicalHash(value: string, description: string): string {
	if (!/^[0-9a-f]{64}$/u.test(value)) throw new Error(`External operation ${description} must be a lowercase SHA-256 digest`);
	return value;
}

function shadowMissingOwnFields<T extends object>(value: T, fields: readonly string[]): T {
	for (let index = 0; index < fields.length; index++) {
		const field = fields[index]!;
		if (Object.getOwnPropertyDescriptor(value, field) !== undefined) continue;
		Object.defineProperty(value, field, {
			configurable: false,
			enumerable: false,
			value: undefined,
			writable: false,
		});
	}
	return value;
}

function assertKnown<T extends string>(known: ReadonlySet<T>, value: T, description: string): void {
	if (!known.has(value)) throw new Error(`Unknown ${description}: ${String(value)}`);
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
