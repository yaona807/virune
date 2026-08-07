import type {
	ForeignCallResolution,
	ForeignTypeSnapshot,
	InteropArgumentType,
	JsImportResolution,
	ModuleResolutionWitness,
	RuntimeImportPlan,
} from '@virune/compiler/experimental';
import type {
	InteropEvidence,
	InteropEvidenceSource,
	InteropFacetIR,
	InteropFacts,
	InteropProfile,
	InteropRuntimeRepresentation,
	InteropTargetProfile,
	InteropTransfer,
} from './classifier.js';

export type ProviderInteropUsage = 'import' | 'property' | 'call' | 'construct' | 'await';

export interface ProviderInteropFactInput {
	readonly usage: ProviderInteropUsage;
	readonly subject: ForeignTypeSnapshot;
	readonly result?: ForeignTypeSnapshot;
	readonly callResolution?: ForeignCallResolution;
	readonly argumentsList?: readonly InteropArgumentType[];
	readonly witness?: ModuleResolutionWitness;
	readonly runtimeImport?: RuntimeImportPlan;
	readonly runtimeBinding?: InteropFacetIR['runtimeBinding'];
	readonly receiver?: InteropFacetIR['receiver'];
	readonly target?: InteropTargetProfile;
}

export function factsFromImportResolution(resolution: JsImportResolution): InteropFacts | undefined {
	if (resolution.type === undefined) return undefined;
	return extractProviderInteropFacts({
		usage: 'import',
		subject: resolution.type,
		witness: resolution.witness,
		runtimeImport: resolution.runtime,
		runtimeBinding: resolution.runtime.kind === 'type-only' ? 'not-applicable' : 'unverified',
	});
}

export function extractProviderInteropFacts(input: ProviderInteropFactInput): InteropFacts {
	const result = resultOf(input);
	const outputTransfer = outputOf(input, result);
	const delivery = deliveryOf(input, result);
	const shape: InteropFacetIR = {
		facets: facetsOf(input.usage, input.subject),
		runtimeRepresentation: representationOf(input.subject),
		typeCertainty: certaintyOf(input.subject),
		structuralData: structuralDataOf(input.subject),
		runtimeBinding: input.runtimeBinding ?? defaultRuntimeBinding(input),
		dynamic: false,
		...(needsCallResolution(input.usage)
			? { callResolution: input.callResolution === undefined ? 'unknown' as const : 'resolved' as const }
			: {}),
		...(input.receiver === undefined ? {} : { receiver: input.receiver }),
	};
	const profile: InteropProfile = {
		direction: input.usage === 'call' || input.usage === 'construct' ? 'bidirectional' : 'inbound',
		cardinality: delivery === 'sync' || delivery === 'promise' ? 'one' : 'unknown',
		lifetime: lifetimeOf(input, delivery, result),
		ownership: outputTransfer === 'primitive' || outputTransfer === 'codec' ? 'value' : 'unknown',
		delivery,
		concurrency: 'unknown',
		flowControl: delivery === 'sync' || delivery === 'promise' ? 'none' : 'unknown',
		realm: 'same',
		execution: 'unknown',
		environment: input.target ?? input.witness?.platform ?? 'neutral',
	};
	return {
		shape,
		profile,
		inputTransfer: argumentsTransfer(input.argumentsList),
		outputTransfer,
		evidence: evidenceOf(input, result),
	};
}

function resultOf(input: ProviderInteropFactInput): ForeignTypeSnapshot {
	if ((input.usage === 'call' || input.usage === 'construct') && input.callResolution !== undefined) return input.callResolution.result;
	return input.result ?? input.subject;
}

function facetsOf(usage: ProviderInteropUsage, subject: ForeignTypeSnapshot): readonly InteropFacetIR['facets'][number][] {
	const facets: InteropFacetIR['facets'][number][] = usage === 'property' ? ['property'] : usage === 'await' ? [] : ['value'];
	if (usage === 'call' || ((usage === 'import' || usage === 'property') && subject.category === 'function')) facets.push('call');
	if (usage === 'construct' || ((usage === 'import' || usage === 'property') && subject.category === 'constructor')) facets.push('construct');
	return [...new Set(facets)];
}

function representationOf(snapshot: ForeignTypeSnapshot): InteropRuntimeRepresentation {
	switch (snapshot.category) {
		case 'primitive':
		case 'literal':
			switch (snapshot.primitive) {
				case 'boolean': return 'boolean';
				case 'string': return 'string';
				case 'number': return 'number';
				case 'bigint': return 'bigint';
				case 'null': return 'null';
				case 'void':
				case 'undefined': return 'undefined';
				case undefined: return 'unknown';
			}
			return 'unknown';
		case 'function':
		case 'constructor': return 'function';
		case 'promise': return 'promise';
		case 'array':
		case 'tuple': return 'array';
		case 'object': return 'object';
		case 'union':
		case 'unknown':
		case 'any': return 'unknown';
	}
}

function certaintyOf(snapshot: ForeignTypeSnapshot): InteropFacetIR['typeCertainty'] {
	if (snapshot.category === 'any') return 'any';
	if (snapshot.category === 'unknown') return 'unknown';
	const path = snapshot.origin?.declarationPath?.toLowerCase();
	if (path === undefined) return 'inferred';
	return path.endsWith('.d.ts') || path.endsWith('.d.mts') || path.endsWith('.d.cts') ? 'declared' : 'inferred';
}

function structuralDataOf(snapshot: ForeignTypeSnapshot): NonNullable<InteropFacetIR['structuralData']> {
	return snapshot.category === 'array' || snapshot.category === 'tuple' || snapshot.category === 'object'
		? 'snapshot-unknown'
		: 'none';
}

function transferOf(snapshot: ForeignTypeSnapshot): InteropTransfer {
	switch (snapshot.category) {
		case 'primitive':
		case 'literal': return 'primitive';
		case 'function':
		case 'constructor':
		case 'object':
		case 'array':
		case 'tuple':
		case 'promise': return 'foreign-identity';
		case 'union':
		case 'unknown':
		case 'any': return 'unknown';
	}
}

function outputOf(input: ProviderInteropFactInput, result: ForeignTypeSnapshot): InteropTransfer {
	if ((input.usage === 'call' || input.usage === 'construct') && input.callResolution === undefined) return 'unknown';
	if (input.usage === 'await' && input.result === undefined) return 'unknown';
	return transferOf(result);
}

function argumentsTransfer(args: readonly InteropArgumentType[] | undefined): InteropTransfer {
	if (args === undefined || args.length === 0) return 'primitive';
	let foreign = false;
	for (const argument of args) {
		if (argument.kind === 'unknown') return 'unknown';
		if (argument.kind === 'foreign') foreign = true;
	}
	return foreign ? 'foreign-identity' : 'primitive';
}

function deliveryOf(input: ProviderInteropFactInput, result: ForeignTypeSnapshot): InteropProfile['delivery'] {
	if (input.usage === 'await') return 'promise';
	if (input.usage !== 'call' && input.usage !== 'construct') return 'sync';
	if (input.callResolution === undefined) return 'unknown';
	return input.callResolution.mayReject === true || result.category === 'promise' ? 'promise' : 'sync';
}

function lifetimeOf(input: ProviderInteropFactInput, delivery: InteropProfile['delivery'], result: ForeignTypeSnapshot): InteropProfile['lifetime'] {
	if (delivery === 'unknown') return 'unknown';
	if (delivery === 'promise') return 'operation';
	if (input.usage === 'call' || input.usage === 'construct') return 'call';
	return result.category === 'primitive' || result.category === 'literal' ? 'call' : 'unknown';
}

function defaultRuntimeBinding(input: ProviderInteropFactInput): NonNullable<InteropFacetIR['runtimeBinding']> {
	if (input.runtimeImport?.kind === 'type-only') return 'not-applicable';
	return 'unverified';
}

function evidenceOf(input: ProviderInteropFactInput, result: ForeignTypeSnapshot): readonly InteropEvidence[] {
	const source = evidenceSourceOf(input.subject);
	const evidence: InteropEvidence[] = [{ source, fact: 'type-contract', detail: input.subject.display }];
	if (input.callResolution !== undefined) {
		evidence.push({
			source,
			fact: 'resolved-call',
			detail: `params=${input.callResolution.parameterCount}; optional=${input.callResolution.optionalParameterCount}; rest=${String(input.callResolution.rest)}; result=${result.display}`,
		});
	}
	if (input.witness !== undefined) evidence.push({ source: 'resolution-witness', fact: 'module-resolution', detail: witnessDetail(input.witness) });
	return evidence;
}

function evidenceSourceOf(snapshot: ForeignTypeSnapshot): InteropEvidenceSource {
	const path = snapshot.origin?.declarationPath?.toLowerCase();
	if (path === undefined) return 'typescript-source';
	if (path.endsWith('.d.ts') || path.endsWith('.d.mts') || path.endsWith('.d.cts')) return 'declaration';
	if (path.endsWith('.js') || path.endsWith('.jsx') || path.endsWith('.mjs') || path.endsWith('.cjs')) return 'javascript-inference';
	return 'typescript-source';
}

function witnessDetail(witness: ModuleResolutionWitness): string {
	const declaration = witness.declarationEntry ?? '<none>';
	const runtime = witness.runtimeEntry ?? (witness.runtimeFormat === 'builtin' ? '<builtin>' : '<none>');
	return `${witness.moduleSpecifier}; platform=${witness.platform}; format=${witness.runtimeFormat ?? 'unknown'}; declaration=${declaration}; runtime=${runtime}`;
}

function needsCallResolution(usage: ProviderInteropUsage): boolean {
	return usage === 'call' || usage === 'construct';
}
