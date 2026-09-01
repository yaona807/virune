import type * as A from '../ast/nodes.js';
import type { Diagnostic } from '../diagnostics/diagnostic.js';
import type { InteropSemanticModel, ModuleResolutionWitness } from './types.js';

export type ExternalImportKind = 'runtime' | 'type-only' | 'side-effect';
export type ExternalImportResolutionState = 'resolved' | 'pending' | 'unresolved';

/** Stable, provider-independent audit metadata for one JavaScript import declaration. */
export interface ExternalImportProvenance {
	readonly moduleSpecifier: string;
	readonly kind: ExternalImportKind;
	readonly resolution: ExternalImportResolutionState;
	readonly platform: ModuleResolutionWitness['platform'];
	readonly providerVersion: string;
	readonly packageName?: string;
	readonly packageVersion?: string;
	readonly packageJsonHash?: string;
	readonly declarationPackageName?: string;
	readonly declarationPackageVersion?: string;
	readonly declarationPackageJsonHash?: string;
	readonly declarationEntry?: string;
	readonly declarationGraphHash?: string;
	readonly runtimeEntry?: string;
	readonly runtimeFormat?: ModuleResolutionWitness['runtimeFormat'];
}

export type ExternalImportProvenanceEvidence =
	| { readonly status: 'available'; readonly imports: readonly ExternalImportProvenance[] }
	| { readonly status: 'unavailable' };

const RUNTIME_FORMATS: readonly NonNullable<ModuleResolutionWitness['runtimeFormat']>[] = ['esm', 'commonjs', 'builtin', 'bundler', 'unknown'];
const PLATFORMS: readonly ModuleResolutionWitness['platform'][] = ['node', 'browser', 'neutral'];
const SHA256 = /^[0-9a-f]{64}$/u;

/**
 * Project checked import witnesses into stable audit evidence. This projection is non-authoritative:
 * malformed or contradictory provider evidence becomes unavailable rather than changing checker diagnostics.
 */
export function buildExternalImportProvenanceEvidence(input: {
	readonly module: A.ModuleNode;
	readonly interop: InteropSemanticModel;
	readonly diagnostics: readonly Diagnostic[];
}): ExternalImportProvenanceEvidence {
	if (input.diagnostics.some(diagnostic => diagnostic.severity === 'error')) return unavailable();
	try {
		const imports: ExternalImportProvenance[] = [];
		let witnessIndex = 0;
		for (const declaration of input.module.imports) {
			if (declaration.sourceKind !== 'javascript') continue;
			const count = importResolutionCount(declaration);
			const witnesses = input.interop.moduleWitnesses.slice(witnessIndex, witnessIndex + count);
			if (witnesses.length !== count) throw new Error(`External import provenance is missing module witnesses for ${declaration.source}`);
			witnessIndex += count;
			const kind: ExternalImportKind = declaration.typeOnly
				? 'type-only'
				: declaration.defaultImport === undefined && declaration.namespaceImport === undefined && declaration.items.length === 0
					? 'side-effect'
					: 'runtime';
			const projected = witnesses.map(witness => projectWitness(declaration.source, kind, witness));
			const first = projected[0]!;
			if (projected.some(item => !sameProvenance(first, item))) throw new Error(`External import provenance is contradictory for ${declaration.source}`);
			imports.push(first);
		}
		if (witnessIndex !== input.interop.moduleWitnesses.length) throw new Error('External import provenance contains unconsumed module witnesses');
		return Object.freeze({ status: 'available', imports: Object.freeze(imports) });
	} catch {
		return unavailable();
	}
}

/**
 * Fail closed when import provenance is not sufficient for a publication-time legal audit.
 * This validates auditability only; it does not decide whether a dependency license is acceptable.
 */
export function assertExternalImportLegalMetadata(evidence: ExternalImportProvenanceEvidence): void {
	if (evidence.status !== 'available') throw new Error('External import provenance evidence is unavailable');
	for (const item of evidence.imports) {
		if (item.resolution !== 'resolved') throw new Error(`External import ${JSON.stringify(item.moduleSpecifier)} is ${item.resolution}; legal metadata is not publishable`);
		assertPackageTuple(item.moduleSpecifier, 'runtime package', item.packageName, item.packageVersion, item.packageJsonHash);
		assertPackageTuple(item.moduleSpecifier, 'declaration package', item.declarationPackageName, item.declarationPackageVersion, item.declarationPackageJsonHash);
		if (item.kind !== 'side-effect' && (item.declarationEntry === undefined || item.declarationGraphHash === undefined)) {
			throw new Error(`External import ${JSON.stringify(item.moduleSpecifier)} is missing declaration provenance`);
		}
		if (item.kind !== 'type-only' && (item.runtimeFormat === 'esm' || item.runtimeFormat === 'commonjs' || item.runtimeFormat === 'builtin') && item.runtimeEntry === undefined) {
			throw new Error(`External import ${JSON.stringify(item.moduleSpecifier)} is missing runtime entry provenance`);
		}
	}
}

function projectWitness(moduleSpecifier: string, kind: ExternalImportKind, witness: ModuleResolutionWitness): ExternalImportProvenance {
	if (stableText(witness.moduleSpecifier, 'module specifier') !== stableText(moduleSpecifier, 'import module specifier')) throw new Error('External import witness module specifier mismatch');
	if (!PLATFORMS.includes(witness.platform)) throw new Error('External import witness has unknown platform');
	if (witness.runtimeFormat !== undefined && !RUNTIME_FORMATS.includes(witness.runtimeFormat)) throw new Error('External import witness has unknown runtime format');
	const providerVersion = stableText(witness.providerVersion, 'provider version');
	const packageName = optionalText(witness.packageName, 'package name');
	const packageVersion = optionalText(witness.packageVersion, 'package version');
	const packageJsonHash = optionalHash(witness.packageJsonHash, 'package.json hash');
	const declarationPackageName = optionalText(witness.declarationPackageName, 'declaration package name');
	const declarationPackageVersion = optionalText(witness.declarationPackageVersion, 'declaration package version');
	const declarationPackageJsonHash = optionalHash(witness.declarationPackageJsonHash, 'declaration package.json hash');
	const declarationEntry = optionalText(witness.declarationEntry, 'declaration entry');
	const declarationGraphHash = optionalHash(witness.declarationGraphHash, 'declaration graph hash');
	const runtimeEntry = optionalText(witness.runtimeEntry, 'runtime entry');
	const packageComplete = completeTuple(packageName, packageVersion, packageJsonHash);
	const declarationPackageComplete = completeTuple(declarationPackageName, declarationPackageVersion, declarationPackageJsonHash);
	const declarationComplete = kind === 'side-effect' || (declarationEntry !== undefined && declarationGraphHash !== undefined);
	let resolution: ExternalImportResolutionState;
	if (!packageComplete || !declarationPackageComplete || !declarationComplete) resolution = 'unresolved';
	else if (kind === 'type-only') resolution = 'resolved';
	else if (witness.runtimeFormat === 'bundler') resolution = 'pending';
	else if (witness.runtimeFormat === undefined || witness.runtimeFormat === 'unknown') resolution = 'unresolved';
	else if (runtimeEntry === undefined) resolution = 'unresolved';
	else resolution = 'resolved';
	return Object.freeze({
		moduleSpecifier,
		kind,
		resolution,
		platform: witness.platform,
		providerVersion,
		...(packageName === undefined ? {} : { packageName }),
		...(packageVersion === undefined ? {} : { packageVersion }),
		...(packageJsonHash === undefined ? {} : { packageJsonHash }),
		...(declarationPackageName === undefined ? {} : { declarationPackageName }),
		...(declarationPackageVersion === undefined ? {} : { declarationPackageVersion }),
		...(declarationPackageJsonHash === undefined ? {} : { declarationPackageJsonHash }),
		...(declarationEntry === undefined ? {} : { declarationEntry }),
		...(declarationGraphHash === undefined ? {} : { declarationGraphHash }),
		...(runtimeEntry === undefined ? {} : { runtimeEntry }),
		...(witness.runtimeFormat === undefined ? {} : { runtimeFormat: witness.runtimeFormat }),
	});
}

function importResolutionCount(declaration: A.ImportDeclaration): number {
	if (declaration.defaultImport !== undefined || declaration.namespaceImport !== undefined) return 1;
	return Math.max(1, declaration.items.length);
}

function sameProvenance(left: ExternalImportProvenance, right: ExternalImportProvenance): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function completeTuple(...values: readonly (string | undefined)[]): boolean {
	return values.every(value => value === undefined) || values.every(value => value !== undefined);
}

function assertPackageTuple(moduleSpecifier: string, label: string, name: string | undefined, version: string | undefined, hash: string | undefined): void {
	if (completeTuple(name, version, hash)) return;
	throw new Error(`External import ${JSON.stringify(moduleSpecifier)} has incomplete ${label} provenance`);
}

function stableText(value: string, label: string): string {
	if (typeof value !== 'string' || value.length === 0 || /[\u0000\r\n]/u.test(value)) throw new Error(`External import provenance has invalid ${label}`);
	return value;
}

function optionalText(value: string | undefined, label: string): string | undefined {
	return value === undefined ? undefined : stableText(value, label);
}

function optionalHash(value: string | undefined, label: string): string | undefined {
	if (value === undefined) return undefined;
	if (!SHA256.test(value)) throw new Error(`External import provenance has invalid ${label}`);
	return value;
}

function unavailable(): ExternalImportProvenanceEvidence {
	return Object.freeze({ status: 'unavailable' });
}
