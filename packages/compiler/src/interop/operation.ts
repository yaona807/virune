import type * as A from '../ast/nodes.js';
import type { Diagnostic } from '../diagnostics/diagnostic.js';
import type { NodeId, SourceSpan } from '../source.js';
import type {
	ForeignOrigin,
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

export interface ExternalForeignOrigin {
	readonly moduleSpecifier: string;
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

interface ExternalOperationBase {
	readonly kind: ExternalOperationKind;
	readonly nodeId: NodeId;
	readonly span: SourceSpan;
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
	readonly result: ExternalForeignValueShape;
}

export interface ExternalCallOperationIR extends ExternalOperationBase {
	readonly kind: 'call';
	readonly result: ExternalForeignValueShape;
	readonly receiverMode: 'none' | 'preserve-this';
	readonly mayReject: boolean;
}

export interface ExternalAwaitOperationIR extends ExternalOperationBase {
	readonly kind: 'await';
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
	if (input.diagnostics.some(diagnostic => diagnostic.severity === 'error')) return [];

	const nodeAnchors = collectAstNodeAnchors(input.module);
	for (const usage of input.interop.usageIR) assertCurrentUsageAnchor(usage, nodeAnchors);

	const operations: ExternalOperationIR[] = [];
	let witnessIndex = 0;
	let runtimeImportDeclarations = 0;
	for (const declaration of input.module.imports) {
		if (declaration.sourceKind !== 'javascript') continue;
		const witnessCount = importResolutionCount(declaration);
		const witnesses = input.interop.moduleWitnesses.slice(witnessIndex, witnessIndex + witnessCount);
		if (witnesses.length !== witnessCount) throw new Error(`External operation evidence is missing module witnesses for ${declaration.source}`);
		witnessIndex += witnessCount;
		if (declaration.typeOnly) continue;
		runtimeImportDeclarations++;
		operations.push(externalModuleLoadOperation({
			nodeId: declaration.id,
			span: declaration.span,
			moduleSpecifier: declaration.source,
			witnesses,
		}));
	}
	if (witnessIndex !== input.interop.moduleWitnesses.length) throw new Error('External operation evidence contains unconsumed module witnesses');
	if (input.interop.requiresJavaScriptInitialization !== (runtimeImportDeclarations > 0)) {
		throw new Error('External operation JavaScript initialization state disagrees with source import semantics');
	}

	for (const usage of input.interop.usageIR) {
		const operation = externalOperationFromUsage(usage);
		if (operation !== undefined) operations.push(operation);
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
	const anchor = { nodeId: usage.nodeId, span: usage.span };
	switch (usage.kind) {
		case 'import': return undefined;
		case 'property':
			return {
				kind: 'read-property',
				...anchor,
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
				result: canonicalForeignType(usage.foreignType),
				mayReject: usage.mayReject,
				decision: directDecision(),
			};
		case 'bridge': {
			if (usage.bridge?.kind !== 'primitive') throw new Error('External primitive bridge operation requires an explicit primitive bridge plan');
			assertKnown(BRIDGES, usage.bridge.bridge, 'primitive bridge');
			return {
				kind: 'bridge-foreign-primitive',
				...anchor,
				source: canonicalForeignType(usage.foreignType),
				bridge: usage.bridge.bridge,
				decision: directDecision(['primitive-bridge-validated']),
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
	const moduleSpecifier = canonicalModuleSpecifier(input.moduleSpecifier, 'ModuleLoad module specifier');
	if (input.witnesses.length === 0) {
		return {
			kind: 'module-load',
			nodeId: input.nodeId,
			span: input.span,
			moduleSpecifier,
			decision: unresolvedDirectDecision(),
		};
	}
	const witnesses = input.witnesses.map(witness => canonicalRuntimeWitness(witness, moduleSpecifier));
	const first = witnesses[0]!;
	if (witnesses.some(witness => !sameRuntimeWitness(first, witness))) {
		return {
			kind: 'module-load',
			nodeId: input.nodeId,
			span: input.span,
			moduleSpecifier,
			decision: unresolvedDirectDecision(),
		};
	}
	return {
		kind: 'module-load',
		nodeId: input.nodeId,
		span: input.span,
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
	return {
		category: snapshot.category,
		...(snapshot.primitive === undefined ? {} : { primitive: snapshot.primitive }),
		...(snapshot.mustUse === undefined ? {} : { mustUse: snapshot.mustUse }),
		...(snapshot.origin === undefined ? {} : { origin: canonicalOrigin(snapshot.origin) }),
	};
}

function canonicalOrigin(origin: ForeignOrigin): ExternalForeignOrigin {
	return {
		moduleSpecifier: canonicalModuleSpecifier(origin.moduleSpecifier, 'origin module specifier'),
		...(origin.packageName === undefined ? {} : { packageName: canonicalProviderText(origin.packageName, 'origin package name') }),
		...(origin.packageVersion === undefined ? {} : { packageVersion: canonicalProviderText(origin.packageVersion, 'origin package version') }),
		...(origin.exportName === undefined ? {} : { exportName: canonicalProviderText(origin.exportName, 'origin export name') }),
	};
}

function canonicalRuntimeWitness(witness: ModuleResolutionWitness, moduleSpecifier: string): ExternalRuntimeResolutionWitness {
	if (witness.moduleSpecifier !== moduleSpecifier) throw new Error('External ModuleLoad witness must resolve the same module specifier');
	assertKnown(PLATFORMS, witness.platform, 'module witness platform');
	if (witness.runtimeFormat !== undefined) assertKnown(RUNTIME_FORMATS, witness.runtimeFormat, 'module witness runtime format');
	const conditions = witness.conditions.map(condition => canonicalProviderText(condition, 'module witness condition'));
	return {
		moduleSpecifier,
		...(witness.packageName === undefined ? {} : { packageName: canonicalProviderText(witness.packageName, 'runtime package name') }),
		...(witness.packageVersion === undefined ? {} : { packageVersion: canonicalProviderText(witness.packageVersion, 'runtime package version') }),
		...(witness.runtimeEntry === undefined ? {} : { runtimeEntry: canonicalRuntimeEntry(witness.runtimeEntry, witness.runtimeFormat) }),
		...(witness.runtimeFormat === undefined ? {} : { runtimeFormat: witness.runtimeFormat }),
		conditions,
		platform: witness.platform,
		...(witness.packageJsonHash === undefined ? {} : { packageJsonHash: canonicalHash(witness.packageJsonHash, 'runtime package.json hash') }),
	};
}

function sameRuntimeWitness(left: ExternalRuntimeResolutionWitness, right: ExternalRuntimeResolutionWitness): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function collectAstNodeAnchors(module: A.ModuleNode): ReadonlyMap<NodeId, AstNodeAnchor> {
	const result = new Map<NodeId, AstNodeAnchor>();
	const seen = new Set<object>();
	const visit = (value: unknown): void => {
		if (value === null || typeof value !== 'object') return;
		if (seen.has(value)) return;
		seen.add(value);
		if (Array.isArray(value)) {
			for (const item of value) visit(item);
			return;
		}
		const record = value as Record<string, unknown>;
		if (typeof record.id === 'number' && typeof record.kind === 'string' && isSourceSpan(record.span)) {
			if (result.has(record.id as NodeId)) throw new Error(`Duplicate AST node id ${record.id} in External operation source binding`);
			const foreignBridge = typeof record.foreignBridge === 'string' && BRIDGES.has(record.foreignBridge as PrimitiveBridgeKind)
				? record.foreignBridge as PrimitiveBridgeKind
				: undefined;
			result.set(record.id as NodeId, {
				kind: record.kind,
				span: record.span,
				...(record.foreignCall === true ? { foreignCall: true as const } : {}),
				...(foreignBridge === undefined ? {} : { foreignBridge }),
			});
		}
		for (const child of Object.values(record)) visit(child);
	};
	visit(module);
	return result;
}

function assertCurrentUsageAnchor(usage: ForeignUsageIR, nodeAnchors: ReadonlyMap<NodeId, AstNodeAnchor>): void {
	const current = nodeAnchors.get(usage.nodeId);
	if (current === undefined || !sameSpan(current.span, usage.span) || !usageMatchesAstAnchor(usage, current)) {
		throw new Error(`Stale or cross-session External usage evidence for node ${usage.nodeId}`);
	}
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

function isSourceSpan(value: unknown): value is SourceSpan {
	if (value === null || typeof value !== 'object') return false;
	const span = value as Partial<SourceSpan>;
	return typeof span.fileId === 'number' && isSourcePosition(span.start) && isSourcePosition(span.end);
}

function isSourcePosition(value: unknown): value is SourceSpan['start'] {
	if (value === null || typeof value !== 'object') return false;
	const position = value as Partial<SourceSpan['start']>;
	return typeof position.offset === 'number' && typeof position.line === 'number' && typeof position.column === 'number';
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

function canonicalRuntimeEntry(value: string, format: ModuleResolutionWitness['runtimeFormat']): string {
	if (format === 'builtin') {
		const builtin = canonicalStableText(value, 'builtin runtime entry');
		if (!builtin.startsWith('node:') || builtin.length === 'node:'.length) throw new Error('External operation builtin runtime entry must use a non-empty node: specifier');
		return builtin;
	}
	return canonicalRelativeLocator(value, 'runtime entry');
}

function canonicalModuleSpecifier(value: string, description: string): string {
	canonicalStableText(value, description);
	if (value.includes('\\')) throw new Error(`External operation ${description} must use canonical forward slashes`);
	if (value.startsWith('/') || /^file:/iu.test(value) || /^[A-Za-z]:/u.test(value)) throw new Error(`External operation ${description} must not be absolute or drive-relative`);
	return value;
}

function canonicalProviderText(value: string, description: string): string {
	canonicalStableText(value, description);
	if (value.includes('\\') || value.startsWith('/') || /^file:/iu.test(value) || /^[A-Za-z]:/u.test(value)) {
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
	if (value.startsWith('/') || /^file:/iu.test(value) || /^[A-Za-z]:/u.test(value)) throw new Error(`External operation ${description} must not be absolute or drive-relative`);
	const segments = value.split('/');
	if (segments.some(segment => segment.length === 0 || segment === '.' || segment === '..')) throw new Error(`External operation ${description} must be a canonical relative locator`);
	return value;
}

function canonicalHash(value: string, description: string): string {
	if (!/^[0-9a-f]{64}$/u.test(value)) throw new Error(`External operation ${description} must be a lowercase SHA-256 digest`);
	return value;
}

function assertKnown<T extends string>(known: ReadonlySet<T>, value: T, description: string): void {
	if (!known.has(value)) throw new Error(`Unknown ${description}: ${String(value)}`);
}