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

function input(): SemanticSnapshotInputV1 {
	return {
		closure: {
			languageVersion: '1.0',
			platform: 'node',
			profile: 'semantic-evidence.experimental.v1',
			analyzerSha256: A,
			sourceManifestSha256: B,
			interopManifestSha256: C,
			configurationSha256: null,
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
	assert.match(serializeExperimentalSemanticSnapshot(modeledOnly), /"allEnumeratedRootsModeled":true/u);
	assert.doesNotMatch(serializeExperimentalSemanticSnapshot(modeledOnly), /"complete":true/u);
});

test('non-modeled coverage requires an explicit limitation', () => {
	const value = input();
	const roots = value.roots.map(root => root.coverage === 'unknown' ? { ...root, limitations: [] } : root);
	assert.throws(
		() => createExperimentalSemanticSnapshot({ ...value, roots }),
		(error: unknown) => error instanceof SemanticSnapshotError
			&& error.path === '$.roots[1].limitations'
			&& /requires at least one explicit limitation/u.test(error.message),
	);
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

test('input closure and source evidence reject stale-looking malformed identity', () => {
	const value = input();
	assert.throws(
		() => createExperimentalSemanticSnapshot({
			...value,
			closure: { ...value.closure, analyzerSha256: 'not-a-hash' },
		}),
		(error: unknown) => error instanceof SemanticSnapshotError && error.path === '$.closure.analyzerSha256',
	);

	const root = value.roots[0]!;
	assert.throws(
		() => createExperimentalSemanticSnapshot({
			...value,
			roots: [{
				...root,
				sourceEvidence: [{ sourcePath: '../../outside.virune', startOffset: 0, endOffset: 1 }],
			}],
		}),
		(error: unknown) => error instanceof SemanticSnapshotError
			&& error.path === '$.roots[0].sourceEvidence[0].sourcePath',
	);
});
