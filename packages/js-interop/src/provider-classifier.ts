import { readFileSync } from 'node:fs';
import type { JsImportResolution } from '@virune/compiler/experimental';
import { classifyInterop, type InteropDecision, type InteropFacts } from './classifier.js';
import { extractProviderInteropFacts } from './provider-facts.js';
import {
	verifyStaticRuntimeBinding,
	type RuntimeBindingEvidence,
	type RuntimeBindingRequest,
} from './runtime-binding.js';

export interface ProviderClassifierOptions {
	/** Override file reads for isolated measurement sandboxes and tests. */
	readonly readRuntimeSource?: (path: string) => string | undefined;
}

export interface ProviderImportClassification {
	readonly facts: InteropFacts;
	readonly decision: InteropDecision;
	readonly runtimeBinding: RuntimeBindingEvidence;
}

/**
 * Combines TypeScript contract evidence with conservative static runtime-binding
 * evidence. The runtime module is never executed here.
 */
export function classifyImportResolution(
	resolution: JsImportResolution,
	options: ProviderClassifierOptions = {},
): ProviderImportClassification | undefined {
	if (resolution.type === undefined) return undefined;
	const runtimeBinding = runtimeEvidence(resolution, options.readRuntimeSource ?? readSourceSafely);
	const mappedBinding = runtimeBinding.status === 'verified-static'
		? 'verified' as const
		: runtimeBinding.status === 'not-applicable'
			? 'not-applicable' as const
			: 'unverified' as const;
	const base = extractProviderInteropFacts({
		usage: 'import',
		subject: resolution.type,
		witness: resolution.witness,
		runtimeImport: resolution.runtime,
		runtimeBinding: mappedBinding,
	});
	const facts: InteropFacts = {
		...base,
		...(runtimeBinding.status === 'absent' ? { evidenceConflict: true } : {}),
		evidence: [
			...(base.evidence ?? []),
			{
				source: 'static-behavior',
				fact: 'runtime-binding',
				detail: `${runtimeBinding.status}:${runtimeBinding.reason}`,
			} as const,
		],
	};
	return { facts, decision: classifyInterop(facts), runtimeBinding };
}

export function runtimeEvidence(
	resolution: JsImportResolution,
	readRuntimeSource: (path: string) => string | undefined = readSourceSafely,
): RuntimeBindingEvidence {
	const request: RuntimeBindingRequest = {
		runtimeFormat: resolution.witness.runtimeFormat ?? 'unknown',
		kind: resolution.runtime.kind,
		...(resolution.runtime.kind === 'named' ? { importedName: resolution.runtime.importedName } : {}),
		...(resolution.witness.runtimeEntry === undefined ? {} : { sourcePath: resolution.witness.runtimeEntry }),
	};
	if (needsSource(request) && resolution.witness.runtimeEntry !== undefined) {
		const sourceText = readRuntimeSource(resolution.witness.runtimeEntry);
		return verifyStaticRuntimeBinding({ ...request, ...(sourceText === undefined ? {} : { sourceText }) });
	}
	return verifyStaticRuntimeBinding(request);
}

function needsSource(request: RuntimeBindingRequest): boolean {
	if (request.kind === 'type-only' || request.kind === 'side-effect' || request.kind === 'namespace') return false;
	return request.runtimeFormat === 'esm' || request.runtimeFormat === 'commonjs';
}

function readSourceSafely(path: string): string | undefined {
	try {
		return readFileSync(path, 'utf8');
	} catch {
		return undefined;
	}
}
