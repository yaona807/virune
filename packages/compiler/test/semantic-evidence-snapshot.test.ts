import assert from 'node:assert/strict';
import test from 'node:test';
import {
	SemanticSnapshotError,
	createExperimentalSemanticSnapshot,
	serializeExperimentalSemanticSnapshot,
	type SemanticDimensionStateV1,
	type SemanticDimensionStatesV1,
	type SemanticRootInputV1,
	type SemanticSnapshotInputV1,
} from '../src/semantic-evidence/snapshot.js';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);
const D = 'd'.repeat(64);
const E = 'e'.repeat(64);
const F = 'f'.repeat(64);
const G = '0'.repeat(64);
const H = '1'.repeat(64);

function dimension(
	coverage: SemanticDimensionStateV1['coverage'],
	sourcePath: string,
	reasons: readonly string[] = [],
	assumptions: readonly string[] = [],
): SemanticDimensionStateV1 {
	return {
		coverage,
		reasons,
		assumptions,
		sourceEvidence: [{ sourcePath, startOffset: 0, endOffset: 30 }],
	};
}

function modeledDimensions(sourcePath: string): SemanticDimensionStatesV1 {
	return {
		publicAbi: dimension('modeled', sourcePath),
		effects: dimension('modeled', sourcePath),
		interop: dimension('modeled', sourcePath, [], ['runtime binding checked', 'static contract checked']),
		reachableFailures: dimension('modeled', sourcePath),
		panic: dimension('modeled', sourcePath),
		discard: dimension('modeled', sourcePath),
	};
}

function partiallyUnknownDimensions(sourcePath: string): SemanticDimensionStatesV1 {
	return {
		publicAbi: dimension('modeled', sourcePath),
		effects: dimension('unknown', sourcePath, ['dynamic foreign callback effects are not modeled']),
		interop: dimension('unknown', sourcePath, ['dynamic foreign callback topology is not modeled']),
		reachableFailures: dimension('unknown', sourcePath, ['foreign callback failures are not modeled']),
		panic: dimension('unknown', sourcePath, ['foreign callback panic reachability is not modeled']),
		discard: dimension('unknown', sourcePath, ['foreign callback discard reachability is not modeled']),
	};
}

function input(): SemanticSnapshotInputV1 {
	return {
		closure: {
			languageVersion: '1.0',
			platform: 'node',
			profile: 'semantic-evidence.experimental.v1',
			analyzerSha256: A,
			sourceManifestSha256: B,
			projectManifestSha256: E,
			stdlibSha256: F,
			runtimeSha256: G,
			dependencyArtifactsSha256: H,
			interopManifestSha256: C,
			configurationSha256: null,
		},
		rootScope: {
			status: 'partial',
			includedRootClasses: ['public-api', 'configured-entrypoints'],
			excludedRootClasses: ['dynamic-entrypoints'],
		},
		roots: [
			{
				root: 'src/workflow.virune::submit',
				dimensions: {
					...modeledDimensions('src/workflow.virune'),
					publicAbi: dimension('modeled', './src/workflow.virune'),
				},
				implementationSha256: D,
				publicAbi: [
					{ symbol: 'submit', declarationKind: 'function', signature: 'fn submit(Order) -> Result<Receipt, SubmitError>' },
				],
				directEffects: ['write', 'network'],
				transitiveEffects: ['network', 'write'],
				interop: [
					{ specifier: 'node:crypto', tier: 'direct', assumptions: ['node runtime binding verified'] },
				],
				reachableFailures: ['SubmitError'],
				panic: 'no',
				discard: 'no',
			},
			{
				root: 'src/plugin.virune::dispatch',
				dimensions: partiallyUnknownDimensions('src/plugin.virune'),
				implementationSha256: A,
				publicAbi: [],
				directEffects: [],
				transitiveEffects: [],
				interop: [{ specifier: 'plugin-host', tier: 'unknown', assumptions: [] }],
				reachableFailures: [],
				panic: 'unknown',
				discard: 'unknown',
			},
		],
	};
}

function reversedDimension(value: SemanticDimensionStateV1): SemanticDimensionStateV1 {
	return {
		...value,
		reasons: [...value.reasons].reverse(),
		assumptions: [...value.assumptions].reverse(),
		sourceEvidence: [...value.sourceEvidence].reverse(),
	};
}

function reversedDimensions(value: SemanticDimensionStatesV1): SemanticDimensionStatesV1 {
	return {
		publicAbi: reversedDimension(value.publicAbi),
		effects: reversedDimension(value.effects),
		interop: reversedDimension(value.interop),
		reachableFailures: reversedDimension(value.reachableFailures),
		panic: reversedDimension(value.panic),
		discard: reversedDimension(value.discard),
	};
}

function withDimensionSourcePath(value: SemanticDimensionStatesV1, sourcePath: string): SemanticDimensionStatesV1 {
	const rewrite = (item: SemanticDimensionStateV1): SemanticDimensionStateV1 => ({
		...item,
		sourceEvidence: item.sourceEvidence.map(evidence => ({ ...evidence, sourcePath })),
	});
	return {
		publicAbi: rewrite(value.publicAbi),
		effects: rewrite(value.effects),
		interop: rewrite(value.interop),
		reachableFailures: rewrite(value.reachableFailures),
		panic: rewrite(value.panic),
		discard: rewrite(value.discard),
	};
}

test('experimental Semantic Snapshot is byte-deterministic across input ordering', () => {
	const first = createExperimentalSemanticSnapshot(input());
	const reorderedInput = input();
	const reordered = createExperimentalSemanticSnapshot({
		...reorderedInput,
		rootScope: {
			...reorderedInput.rootScope,
			includedRootClasses: [...reorderedInput.rootScope.includedRootClasses].reverse(),
			excludedRootClasses: [...reorderedInput.rootScope.excludedRootClasses].reverse(),
		},
		roots: [...reorderedInput.roots].reverse().map(root => ({
			...root,
			dimensions: reversedDimensions(root.dimensions),
			publicAbi: [...root.publicAbi].reverse(),
			directEffects: [...root.directEffects].reverse(),
			transitiveEffects: [...root.transitiveEffects].reverse(),
			interop: [...root.interop].reverse(),
			reachableFailures: [...root.reachableFailures].reverse(),
		})),
	});
	assert.deepEqual(first, reordered);
	assert.equal(serializeExperimentalSemanticSnapshot(first), serializeExperimentalSemanticSnapshot(reordered));
	assert.deepEqual(first.rootScope.includedRootClasses, ['configured-entrypoints', 'public-api']);
	assert.deepEqual(first.roots.map(root => root.root), [
		'src/plugin.virune::dispatch',
		'src/workflow.virune::submit',
	]);
	assert.deepEqual(first.roots[1]?.directEffects, ['network', 'write']);
	assert.equal(first.roots[1]?.dimensions.publicAbi.sourceEvidence[0]?.sourcePath, 'src/workflow.virune');
	assert.deepEqual(first.roots[1]?.dimensions.interop.assumptions, ['runtime binding checked', 'static contract checked']);
});

test('serialization recomputes aggregate coverage instead of trusting a snapshot-shaped object', () => {
	const canonical = createExperimentalSemanticSnapshot(input());
	const tampered = {
		...canonical,
		coverage: {
			...canonical.coverage,
			unknown: 0,
			allEnumeratedRootsModeled: true,
		},
		roots: canonical.roots.map(root => ({ ...root, coverage: 'modeled' as const })).reverse(),
	};
	const serialized = serializeExperimentalSemanticSnapshot(tampered);
	assert.equal(serialized, serializeExperimentalSemanticSnapshot(input()));
	const parsed = JSON.parse(serialized) as {
		readonly coverage: { readonly unknown: number; readonly allEnumeratedRootsModeled: boolean };
		readonly roots: readonly { readonly coverage: string }[];
	};
	assert.equal(parsed.coverage.unknown, 1);
	assert.equal(parsed.coverage.allEnumeratedRootsModeled, false);
	assert.equal(parsed.roots[0]?.coverage, 'unknown');
});

test('root discovery scope is explicit and fail-closed', () => {
	const value = input();
	const snapshot = createExperimentalSemanticSnapshot(value);
	assert.deepEqual(snapshot.rootScope, {
		status: 'partial',
		includedRootClasses: ['configured-entrypoints', 'public-api'],
		excludedRootClasses: ['dynamic-entrypoints'],
	});

	for (const rootScope of [
		{ status: 'partial' as const, includedRootClasses: ['public-api'], excludedRootClasses: [] },
		{ status: 'project-wide' as const, includedRootClasses: ['public-api'], excludedRootClasses: ['dynamic-entrypoints'] },
		{ status: 'partial' as const, includedRootClasses: ['public-api'], excludedRootClasses: ['public-api'] },
	]) {
		assert.throws(() => createExperimentalSemanticSnapshot({ ...value, rootScope }), SemanticSnapshotError);
	}

	const projectWide = createExperimentalSemanticSnapshot({
		...value,
		rootScope: { status: 'project-wide', includedRootClasses: ['public-api'], excludedRootClasses: [] },
	});
	assert.equal(projectWide.rootScope.status, 'project-wide');
	assert.deepEqual(projectWide.rootScope.excludedRootClasses, []);
});

test('coverage is derived conservatively from independent semantic dimensions', () => {
	const snapshot = createExperimentalSemanticSnapshot(input());
	assert.deepEqual(snapshot.coverage, {
		enumeratedRoots: 2,
		modeled: 1,
		partial: 0,
		opaque: 0,
		unknown: 1,
		allEnumeratedRootsModeled: false,
	});
	const unknown = snapshot.roots.find(root => root.coverage === 'unknown');
	assert.ok(unknown);
	assert.equal(unknown.dimensions.publicAbi.coverage, 'modeled');
	assert.equal(unknown.dimensions.effects.coverage, 'unknown');
	assert.deepEqual(unknown.dimensions.effects.reasons, ['dynamic foreign callback effects are not modeled']);

	const value = input();
	const root = value.roots[0]!;
	const partial = createExperimentalSemanticSnapshot({
		...value,
		roots: [{
			...root,
			dimensions: {
				...root.dimensions,
				effects: dimension('partial', 'src/workflow.virune', ['indirect effects are not modeled']),
			},
		}],
	});
	assert.equal(partial.roots[0]?.coverage, 'partial');
	assert.deepEqual(partial.coverage, {
		enumeratedRoots: 1,
		modeled: 0,
		partial: 1,
		opaque: 0,
		unknown: 0,
		allEnumeratedRootsModeled: false,
	});
});

test('allEnumeratedRootsModeled does not claim the analyzer enumerated every program root', () => {
	const value = input();
	const modeledOnly = createExperimentalSemanticSnapshot({ ...value, roots: [value.roots[0]!] });
	assert.deepEqual(modeledOnly.coverage, {
		enumeratedRoots: 1,
		modeled: 1,
		partial: 0,
		opaque: 0,
		unknown: 0,
		allEnumeratedRootsModeled: true,
	});
	assert.equal(modeledOnly.rootScope.status, 'partial');
	assert.deepEqual(modeledOnly.rootScope.excludedRootClasses, ['dynamic-entrypoints']);
	assert.doesNotMatch(serializeExperimentalSemanticSnapshot(modeledOnly), /"complete":true/u);
});

test('empty root enumeration never produces a safe-looking modeled coverage claim', () => {
	const value = input();
	const empty = createExperimentalSemanticSnapshot({ ...value, roots: [] });
	assert.deepEqual(empty.coverage, {
		enumeratedRoots: 0,
		modeled: 0,
		partial: 0,
		opaque: 0,
		unknown: 0,
		allEnumeratedRootsModeled: false,
	});
});

test('dimension coverage validates reasons, provenance, and modeled fact completeness', () => {
	const value = input();
	const root = value.roots[0]!;
	const cases: readonly [string, SemanticRootInputV1][] = [
		['$.roots[0].dimensions.effects.reasons', {
			...root,
			dimensions: { ...root.dimensions, effects: { ...root.dimensions.effects, reasons: ['incomplete'] } },
		}],
		['$.roots[0].panic', { ...root, panic: 'unknown' }],
		['$.roots[0].discard', { ...root, discard: 'unknown' }],
		['$.roots[0].interop', {
			...root,
			interop: [{ specifier: 'node:crypto', tier: 'unknown', assumptions: [] }],
		}],
		['$.roots[0].dimensions.effects.sourceEvidence', {
			...root,
			dimensions: {
				...root.dimensions,
				effects: { ...root.dimensions.effects, sourceEvidence: [] },
			},
		}],
	];
	for (const [expectedPath, changed] of cases) {
		assert.throws(
			() => createExperimentalSemanticSnapshot({ ...value, roots: [changed] }),
			(error: unknown) => error instanceof SemanticSnapshotError && error.path === expectedPath,
		);
	}
});

test('non-modeled dimensions require a substantive explicit reason', () => {
	const value = input();
	const root = value.roots[0]!;
	for (const reasons of [[], ['   ']]) {
		const changed: SemanticRootInputV1 = {
			...root,
			dimensions: {
				...root.dimensions,
				effects: { ...root.dimensions.effects, coverage: 'unknown', reasons },
			},
		};
		assert.throws(
			() => createExperimentalSemanticSnapshot({ ...value, roots: [changed] }),
			(error: unknown) => error instanceof SemanticSnapshotError
				&& error.path.startsWith('$.roots[0].dimensions.effects.reasons'),
		);
	}
});

test('duplicate semantic identities fail closed instead of being silently deduplicated', () => {
	const value = input();
	assert.throws(
		() => createExperimentalSemanticSnapshot({ ...value, roots: [value.roots[0]!, value.roots[0]!] }),
		(error: unknown) => error instanceof SemanticSnapshotError
			&& error.path === '$.roots'
			&& /duplicate root/u.test(error.message),
	);

	const root = value.roots[0]!;
	assert.throws(
		() => createExperimentalSemanticSnapshot({
			...value,
			roots: [{ ...root, directEffects: ['network', 'network'] }],
		}),
		(error: unknown) => error instanceof SemanticSnapshotError
			&& error.path === '$.roots[0].directEffects'
			&& /duplicate value/u.test(error.message),
	);
});

test('input closure and source evidence reject malformed or non-contained identity', () => {
	const value = input();
	for (const closure of [
		{ ...value.closure, analyzerSha256: 'not-a-hash' },
		{ ...value.closure, runtimeSha256: 'not-a-hash' },
	]) {
		assert.throws(() => createExperimentalSemanticSnapshot({ ...value, closure }), SemanticSnapshotError);
	}

	const root = value.roots[0]!;
	for (const sourcePath of ['../../outside.virune', 'src/../other.virune']) {
		const changed: SemanticRootInputV1 = {
			...root,
			dimensions: {
				...root.dimensions,
				effects: dimension('modeled', sourcePath),
			},
		};
		assert.throws(
			() => createExperimentalSemanticSnapshot({ ...value, roots: [changed] }),
			(error: unknown) => error instanceof SemanticSnapshotError
				&& error.path === '$.roots[0].dimensions.effects.sourceEvidence[0].sourcePath',
		);
	}
});

test('case-colliding source paths fail closed across semantic dimensions', () => {
	const value = input();
	const first = value.roots[0]!;
	const second = value.roots[1]!;
	const changed: SemanticRootInputV1 = {
		...second,
		dimensions: withDimensionSourcePath(second.dimensions, 'src/Workflow.virune'),
	};
	assert.equal(first.dimensions.effects.sourceEvidence[0]?.sourcePath, 'src/workflow.virune');
	assert.throws(
		() => createExperimentalSemanticSnapshot({ ...value, roots: [first, changed] }),
		(error: unknown) => error instanceof SemanticSnapshotError
			&& error.path === '$.roots'
			&& /case-colliding source paths/u.test(error.message),
	);
});
