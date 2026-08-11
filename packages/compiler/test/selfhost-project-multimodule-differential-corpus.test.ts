import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { validateKernelInput } from '../src/selfhost/contract.js';
import { compileWithLegacyKernel } from '../src/selfhost/legacy-adapter.js';
import { executeKernelOutputWithNode } from '../src/selfhost/node-executor.js';

type DifferentialCorpusFixture = {
	readonly id: string;
	readonly tags: readonly string[];
	readonly input: unknown;
	readonly expectedDivergences?: readonly unknown[];
};

type RuntimeCase = {
	readonly id: string;
	readonly expectedReturnValue: unknown;
	readonly expectedDependencies: readonly {
		readonly modulePath: string;
		readonly sourceKind: string;
		readonly specifier: string;
		readonly resolvedPath: string;
		readonly typeOnly: boolean;
		readonly public: boolean;
	}[];
};

const sourceHashes: Readonly<Record<string, Readonly<Record<string, string>>>> = {
	'project-multimodule-alias-import': {
		'src/helper.virune': '771cf3cf9f8b61d03fbc97bfb5af4d9594393edeeeaa9d75010eea11aabbbb5c',
		'src/main.virune': '1eaf2555b48c742fd82bd0c37339cdceda504b45f4e0ea46226fb82c235f0b50',
	},
	'project-multimodule-type-only-import': {
		'src/domain.virune': '76e32ddb1aa5e5b4412cfd9b2e6891f85ab1639426938b03d73116d07723631e',
		'src/main.virune': '77c13f4a8a763e40382dd693e1621529eb7e277eeb697e2001ab42652a1534b4',
	},
	'project-multimodule-public-enum': {
		'src/domain.virune': 'aa0a4d53e29c71b2bb95901c36d435e0a612321b349d7f2e5c398e4bf47b8fd0',
		'src/main.virune': '2bfc29d15712be82be9818778846fa9c11bf049a78e4e5fdc271030be33d95c7',
	},
};

const runtimeCases: readonly RuntimeCase[] = [
	{
		id: 'project-multimodule-alias-import',
		expectedReturnValue: 42,
		expectedDependencies: [{
			modulePath: 'src/main.virune',
			sourceKind: 'virune',
			specifier: './helper.virune',
			resolvedPath: 'src/helper.virune',
			typeOnly: false,
			public: false,
		}],
	},
	{
		id: 'project-multimodule-type-only-import',
		expectedReturnValue: 7,
		expectedDependencies: [{
			modulePath: 'src/main.virune',
			sourceKind: 'virune',
			specifier: './domain.virune',
			resolvedPath: 'src/domain.virune',
			typeOnly: true,
			public: false,
		}],
	},
	{
		id: 'project-multimodule-public-enum',
		expectedReturnValue: { $tag: 'Pending', $values: [] },
		expectedDependencies: [{
			modulePath: 'src/main.virune',
			sourceKind: 'virune',
			specifier: './domain.virune',
			resolvedPath: 'src/domain.virune',
			typeOnly: false,
			public: false,
		}],
	},
];

function loadDifferentialCorpus(): { readonly fixtures: readonly DifferentialCorpusFixture[] } {
	return JSON.parse(readFileSync(
		new URL('../../../../.github/self-hosting/differential-corpus-v1.json', import.meta.url),
		'utf8',
	)) as { readonly fixtures: readonly DifferentialCorpusFixture[] };
}

test('multi-module Project differential fixtures retain canonical source identity and strict v1 profiles', () => {
	const corpus = loadDifferentialCorpus();
	for (const [fixtureId, expectedHashes] of Object.entries(sourceHashes)) {
		const fixture = corpus.fixtures.find(item => item.id === fixtureId);
		assert.ok(fixture, `missing multi-module differential fixture ${fixtureId}`);
		assert.ok(fixture.tags.includes('project'), `${fixtureId}: project tag`);
		assert.ok(fixture.tags.includes('multi-module'), `${fixtureId}: multi-module tag`);
		assert.deepEqual(fixture.expectedDivergences, [], `${fixtureId}: unexplained differences must not be whitelisted`);
		const fixtureInput = validateKernelInput(fixture.input);
		assert.equal(fixtureInput.platform, 'node', `${fixtureId}: platform`);
		assert.equal(fixtureInput.entryPath, 'src/main.virune', `${fixtureId}: entry path`);
		assert.equal(fixtureInput.sources.length, 2, `${fixtureId}: source count`);
		assert.deepEqual(fixtureInput.interopManifest.modules, [], `${fixtureId}: Interop remains outside this slice`);
		assert.equal(fixtureInput.emit.sourceMap, false, `${fixtureId}: source maps`);
		assert.equal(fixtureInput.emit.sourcesContent, true, `${fixtureId}: sourcesContent`);
		assert.deepEqual(
			Object.fromEntries(fixtureInput.sources.map(source => [
				source.path,
				createHash('sha256').update(source.text, 'utf8').digest('hex'),
			])),
			expectedHashes,
			`${fixtureId}: canonical source identity`,
		);
	}
});

test('positive multi-module fixtures retain independently grounded Legacy dependency and runtime meaning', async t => {
	const corpus = loadDifferentialCorpus();
	for (const runtimeCase of runtimeCases) {
		await t.test(runtimeCase.id, async () => {
			const fixture = corpus.fixtures.find(item => item.id === runtimeCase.id);
			assert.ok(fixture, `missing multi-module runtime fixture ${runtimeCase.id}`);
			assert.ok(fixture.tags.includes('runtime'), `${runtimeCase.id}: runtime tag`);
			const fixtureInput = validateKernelInput(fixture.input);
			const output = await compileWithLegacyKernel(fixtureInput);
			assert.equal(output.accepted, true, `${runtimeCase.id}: Legacy compiler rejected canonical fixture`);
			assert.deepEqual(output.diagnostics, [], `${runtimeCase.id}: Legacy diagnostics`);
			assert.deepEqual(output.dependencies, runtimeCase.expectedDependencies, `${runtimeCase.id}: Legacy dependency baseline`);
			const execution = await executeKernelOutputWithNode(fixtureInput, output);
			assert.equal(execution.exitCode, 0, `${runtimeCase.id}: runtime exit code`);
			assert.equal(execution.signal, null, `${runtimeCase.id}: runtime signal`);
			assert.equal(execution.panic, null, `${runtimeCase.id}: runtime panic`);
			assert.deepEqual(execution.returnValue, runtimeCase.expectedReturnValue, `${runtimeCase.id}: runtime return value`);
		});
	}
});
