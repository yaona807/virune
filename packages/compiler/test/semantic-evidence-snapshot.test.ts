import assert from 'node:assert/strict';
import test from 'node:test';
import {
	SemanticSnapshotError,
	createExperimentalSemanticSnapshot,
	serializeExperimentalSemanticSnapshot,
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
				coverage: 'modeled',
				limitations: [],
				implementationSha256: D,
				sourceEvidence: [
					{ sourcePath: 'src/workflow.virune', startOffset: 20, endOffset: 40 },
					{ sourcePath: './src/workflow.virune', startOffset: 0, endOffset: 10 },
				],
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
				coverage: 'unknown',
				limitations: ['dynamic foreign callback topology is not modeled'],
				implementationSha256: A,
				sourceEvidence: [{ sourcePath: 'src/plugin.virune', startOffset: 0, endOffset: 30 }],
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
			limitations: [...root.limitations].reverse(),
			sourceEvidence: [...root.sourceEvidence].reverse(),
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
	assert.deepEqual(first.roots[1]?.sourceEvidence.map(item => item.sourcePath), [
		'src/workflow.virune',
		'src/workflow.virune',
	]);
});

test('serialization recomputes canonical derived fields instead of trusting a snapshot-shaped object', () => {
	const canonical = createExperimentalSemanticSnapshot(input());
	const tampered = {
		...canonical,
		coverage: {
			...canonical.coverage,
			unknown: 0,
			allEnumeratedRootsModeled: true,
		},
		roots: [...canonical.roots].reverse(),
	};
	const serialized = serializeExperimentalSemanticSnapshot(tampered);
	assert.equal(serialized, serializeExperimentalSemanticSnapshot(input()));
	const parsed = JSON.parse(serialized) as { readonly coverage: { readonly unknown: number; readonly allEnumeratedRootsModeled: boolean } };
	assert.equal(parsed.coverage.unknown, 1);
	assert.equal(parsed.coverage.allEnumeratedRootsModeled, false);
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
		assert.throws(
			() => createExperimentalSemanticSnapshot({ ...value, rootScope }),
			SemanticSnapshotError,
		);
	}

	const projectWide = createExperimentalSemanticSnapshot({
		...value,
		rootScope: { status: 'project-wide', includedRootClasses: ['public-api'], excludedRootClasses: [] },
	});
	assert.equal(projectWide.rootScope.status, 'project-wide');
	assert.deepEqual(projectWide.rootScope.excludedRootClasses, []);
});

test('coverage preserves unknown roots instead of treating empty fact sets as safe', () => {
	const snapshot = createExperimentalSemanticSnapshot(input());
	assert.deepEqual(snapshot.coverage, {
		enumeratedRoots: 2,
		modeled: 1,
		partial: 0,
		opaque: 0,
		unknown: 1,
		allEnumeratedRootsModeled: false,
	});
	assert.equal(snapshot.rootScope.status, 'partial');
	assert.equal(Object.hasOwn(snapshot.coverage, 'complete'), false);
	const unknown = snapshot.roots.find(root => root.coverage === 'unknown');
	assert.ok(unknown);
	assert.deepEqual(unknown.limitations, ['dynamic foreign callback topology is not modeled']);
	assert.equal(unknown.panic, 'unknown');
	assert.equal(unknown.discard, 'unknown');
	assert.match(serializeExperimentalSemanticSnapshot(snapshot), /"coverage":"unknown"/u);
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
	assert.match(serializeExperimentalSemanticSnapshot(modeledOnly), /"allEnumeratedRootsModeled":true/u);
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

test('modeled coverage rejects unresolved semantic dimensions and missing source evidence', () => {
	const value = input();
	const root = value.roots[0]!;
	for (const [field, changed] of [
		['limitations', { ...root, limitations: ['body analysis incomplete'] }],
		['panic', { ...root, panic: 'unknown' as const }],
		['discard', { ...root, discard: 'unknown' as const }],
		['interop', { ...root, interop: [{ specifier: 'node:crypto', tier: 'unknown' as const, assumptions: [] }] }],
	] as const) {
		assert.throws(
			() => createExperimentalSemanticSnapshot({ ...value, roots: [changed] }),
			(error: unknown) => error instanceof SemanticSnapshotError
				&& error.path === `$.roots[0].${field}`,
		);
	}
	assert.throws(
		() => createExperimentalSemanticSnapshot({ ...value, roots: [{ ...root, sourceEvidence: [] }] }),
		(error: unknown) => error instanceof SemanticSnapshotError
			&& error.path === '$.roots[0].sourceEvidence'
			&& /at least one source evidence range/u.test(error.message),
	);
});

test('non-modeled coverage requires a substantive explicit limitation', () => {
	const value = input();
	for (const limitations of [[], ['   ']]) {
		const roots = value.roots.map(root => root.coverage === 'unknown' ? { ...root, limitations } : root);
		assert.throws(
			() => createExperimentalSemanticSnapshot({ ...value, roots }),
			(error: unknown) => error instanceof SemanticSnapshotError
				&& error.path.startsWith('$.roots[1].limitations'),
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
		assert.throws(
			() => createExperimentalSemanticSnapshot({ ...value, closure }),
			SemanticSnapshotError,
		);
	}

	const root = value.roots[0]!;
	for (const sourcePath of ['../../outside.virune', 'src/../other.virune']) {
		assert.throws(
			() => createExperimentalSemanticSnapshot({
				...value,
				roots: [{
					...root,
					sourceEvidence: [{ sourcePath, startOffset: 0, endOffset: 1 }],
				}],
			}),
			(error: unknown) => error instanceof SemanticSnapshotError
				&& error.path === '$.roots[0].sourceEvidence[0].sourcePath',
		);
	}
});
