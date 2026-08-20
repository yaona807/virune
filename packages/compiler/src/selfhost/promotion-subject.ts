import { createHash } from 'node:crypto';

export const PROMOTION_SUBJECT_MANIFEST_VERSION = 2 as const;

export type PromotionSubjectStage =
	| 'required-selfhost'
	| 'required-compiler'
	| 'production-default';

export type PromotionSubjectComponentId =
	| 'bootstrap-policy'
	| 'compiler-api'
	| 'compiler-host-artifact'
	| 'dependency-closure'
	| 'fixed-seed'
	| 'interop-abi'
	| 'js-interop-artifact'
	| 'release-reproducibility'
	| 'reviewed-release-artifact'
	| 'runtime-abi'
	| 'runtime-artifact'
	| 'selfhost-host-contract'
	| 'selfhost-stage3'
	| 'stdlib-artifact';

export interface PromotionSubjectComponentInputV2 {
	readonly id: PromotionSubjectComponentId | string;
	readonly sha256: string;
}

export interface PromotionSubjectManifestInputV2 {
	readonly version: typeof PROMOTION_SUBJECT_MANIFEST_VERSION;
	readonly stage: PromotionSubjectStage;
	readonly components: readonly PromotionSubjectComponentInputV2[];
}

export interface PromotionSubjectComponentV2 {
	readonly id: PromotionSubjectComponentId;
	readonly sha256: string;
}

export interface PromotionSubjectManifestV2 {
	readonly version: typeof PROMOTION_SUBJECT_MANIFEST_VERSION;
	readonly stage: PromotionSubjectStage;
	readonly components: readonly PromotionSubjectComponentV2[];
}

export interface PromotionSubjectManifestResultV2 {
	readonly manifest: PromotionSubjectManifestV2;
	readonly serialized: string;
	readonly promotionSubjectId: string;
}

export class PromotionSubjectManifestError extends Error {
	public override readonly name = 'PromotionSubjectManifestError';
	public constructor(public readonly path: string, message: string) {
		super(`${path}: ${message}`);
	}
}

const sha256Pattern = /^[0-9a-f]{64}$/u;

const requiredComponentsByStage: Readonly<Record<PromotionSubjectStage, readonly PromotionSubjectComponentId[]>> = {
	'required-selfhost': [
		'bootstrap-policy',
		'fixed-seed',
		'runtime-abi',
		'runtime-artifact',
		'selfhost-host-contract',
		'selfhost-stage3',
		'stdlib-artifact',
	],
	'required-compiler': [
		'bootstrap-policy',
		'compiler-api',
		'compiler-host-artifact',
		'dependency-closure',
		'fixed-seed',
		'interop-abi',
		'js-interop-artifact',
		'runtime-abi',
		'runtime-artifact',
		'selfhost-host-contract',
		'selfhost-stage3',
		'stdlib-artifact',
	],
	'production-default': [
		'bootstrap-policy',
		'compiler-api',
		'compiler-host-artifact',
		'dependency-closure',
		'fixed-seed',
		'interop-abi',
		'js-interop-artifact',
		'release-reproducibility',
		'reviewed-release-artifact',
		'runtime-abi',
		'runtime-artifact',
		'selfhost-host-contract',
		'selfhost-stage3',
		'stdlib-artifact',
	],
};

export function createPromotionSubjectManifest(value: unknown): PromotionSubjectManifestResultV2 {
	const input = record(value, '$');
	exactKeys(input, ['version', 'stage', 'components'], '$');
	if (input.version !== PROMOTION_SUBJECT_MANIFEST_VERSION) {
		throw new PromotionSubjectManifestError('$.version', `expected ${PROMOTION_SUBJECT_MANIFEST_VERSION}`);
	}
	const stage = promotionStage(input.stage, '$.stage');
	const componentValues = array(input.components, '$.components');
	const requiredIds = requiredComponentsByStage[stage];
	const requiredIdSet = new Set<string>(requiredIds);
	const componentsById = new Map<PromotionSubjectComponentId, PromotionSubjectComponentV2>();

	for (const [index, valueAtIndex] of componentValues.entries()) {
		const path = `$.components[${index}]`;
		const component = record(valueAtIndex, path);
		exactKeys(component, ['id', 'sha256'], path);
		const id = nonEmptyString(component.id, `${path}.id`);
		if (!requiredIdSet.has(id)) {
			throw new PromotionSubjectManifestError(`${path}.id`, `component ${id} is not part of ${stage}`);
		}
		if (componentsById.has(id as PromotionSubjectComponentId)) {
			throw new PromotionSubjectManifestError(`${path}.id`, `duplicate component ${id}`);
		}
		const sha256 = canonicalSha256(component.sha256, `${path}.sha256`);
		componentsById.set(id as PromotionSubjectComponentId, { id: id as PromotionSubjectComponentId, sha256 });
	}

	const missing = requiredIds.filter(id => !componentsById.has(id));
	if (missing.length > 0) {
		throw new PromotionSubjectManifestError('$.components', `missing required components: ${missing.join(', ')}`);
	}
	if (componentsById.size !== requiredIds.length) {
		throw new PromotionSubjectManifestError('$.components', 'component set does not exactly match the stage contract');
	}

	const manifest: PromotionSubjectManifestV2 = {
		version: PROMOTION_SUBJECT_MANIFEST_VERSION,
		stage,
		components: requiredIds.map(id => componentsById.get(id)!),
	};
	const serialized = JSON.stringify(manifest);
	return {
		manifest,
		serialized,
		promotionSubjectId: sha256(serialized),
	};
}

export function promotionSubjectRequiredComponents(stage: PromotionSubjectStage): readonly PromotionSubjectComponentId[] {
	return [...requiredComponentsByStage[stage]];
}

function promotionStage(value: unknown, path: string): PromotionSubjectStage {
	if (value === 'required-selfhost' || value === 'required-compiler' || value === 'production-default') return value;
	throw new PromotionSubjectManifestError(path, 'expected required-selfhost, required-compiler, or production-default');
}

function canonicalSha256(value: unknown, path: string): string {
	if (typeof value !== 'string' || !sha256Pattern.test(value)) {
		throw new PromotionSubjectManifestError(path, 'expected lowercase 64-character SHA-256');
	}
	return value;
}

function record(value: unknown, path: string): Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new PromotionSubjectManifestError(path, 'expected an object');
	}
	return value as Record<string, unknown>;
}

function array(value: unknown, path: string): readonly unknown[] {
	if (!Array.isArray(value)) throw new PromotionSubjectManifestError(path, 'expected an array');
	return value;
}

function nonEmptyString(value: unknown, path: string): string {
	if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
		throw new PromotionSubjectManifestError(path, 'expected a non-empty canonical string');
	}
	return value;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], path: string): void {
	const actual = Object.keys(value).sort(compareText);
	const wanted = [...expected].sort(compareText);
	if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
		throw new PromotionSubjectManifestError(path, `expected exactly keys ${wanted.join(', ')}`);
	}
}

function sha256(value: string): string {
	return createHash('sha256').update(value, 'utf8').digest('hex');
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
