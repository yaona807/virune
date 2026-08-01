import assert from 'node:assert/strict';
import test from 'node:test';
import {
	MODULE_GRAPH_VERSION,
	ModuleGraphContractError,
	buildCanonicalModuleGraph,
} from '../src/selfhost/module-graph.js';

test('module graph is canonical across module, import, and path ordering', () => {
	const first = buildCanonicalModuleGraph({
		version: MODULE_GRAPH_VERSION,
		entryPath: './src\\main.virune',
		modules: [
			{
				path: 'src/util.virune',
				imports: [],
			},
			{
				path: 'src/main.virune',
				imports: [
					{ specifier: 'pkg', sourceKind: 'javascript', typeOnly: false, public: false },
					{ specifier: './util', sourceKind: 'virune', resolvedPath: 'src/./util.virune', typeOnly: false, public: true },
				],
			},
		],
	});
	const second = buildCanonicalModuleGraph({
		version: MODULE_GRAPH_VERSION,
		entryPath: 'src/main.virune',
		modules: [
			{
				path: 'src/main.virune',
				imports: [
					{ public: true, typeOnly: false, resolvedPath: 'src/util.virune', sourceKind: 'virune', specifier: './util' },
					{ public: false, typeOnly: false, sourceKind: 'javascript', specifier: 'pkg' },
				],
			},
			{ path: 'src/util.virune', imports: [] },
		],
	});

	assert.deepEqual(first, second);
	assert.equal(first.accepted, true);
	assert.equal(first.entryModuleId, 0);
	assert.deepEqual(first.modules.map(module => [module.id, module.path, module.reachable]), [
		[0, 'src/main.virune', true],
		[1, 'src/util.virune', true],
	]);
	assert.deepEqual(first.reachableModuleIds, [0, 1]);
	assert.deepEqual(first.unreachableModuleIds, []);
	assert.deepEqual(first.edges.map(edge => [edge.id, edge.sourceKind, edge.specifier, edge.targetModuleId]), [
		[0, 'javascript', 'pkg', undefined],
		[1, 'virune', './util', 1],
	]);
});

test('missing entry and missing targets fail closed while retaining unreachable modules', () => {
	const result = buildCanonicalModuleGraph({
		version: MODULE_GRAPH_VERSION,
		entryPath: 'src/missing.virune',
		modules: [
			{
				path: 'src/a.virune',
				imports: [{ specifier: './missing', sourceKind: 'virune', resolvedPath: 'src/missing.virune', typeOnly: false, public: false }],
			},
			{ path: 'src/b.virune', imports: [] },
		],
	});

	assert.equal(result.accepted, false);
	assert.equal(result.entryModuleId, null);
	assert.deepEqual(result.reachableModuleIds, []);
	assert.deepEqual(result.unreachableModuleIds, [0, 1]);
	assert.deepEqual(result.issues, [
		{ code: 'MISSING_ENTRY', modulePath: 'src/missing.virune' },
		{ code: 'MISSING_TARGET', modulePath: 'src/a.virune', specifier: './missing' },
	]);
});

test('cycles, self imports, and duplicate imports are reported deterministically', () => {
	const result = buildCanonicalModuleGraph({
		version: MODULE_GRAPH_VERSION,
		entryPath: 'src/a.virune',
		modules: [
			{
				path: 'src/a.virune',
				imports: [
					{ specifier: './b', sourceKind: 'virune', resolvedPath: 'src/b.virune', typeOnly: false, public: false },
					{ specifier: './b', sourceKind: 'virune', resolvedPath: 'src/b.virune', typeOnly: false, public: false },
				],
			},
			{
				path: 'src/b.virune',
				imports: [
					{ specifier: './a', sourceKind: 'virune', resolvedPath: 'src/a.virune', typeOnly: true, public: false },
					{ specifier: './b', sourceKind: 'virune', resolvedPath: 'src/b.virune', typeOnly: false, public: false },
				],
			},
		],
	});

	assert.equal(result.accepted, false);
	assert.deepEqual(result.issues, [
		{ code: 'DUPLICATE_IMPORT', modulePath: 'src/a.virune', specifier: './b' },
		{ code: 'IMPORT_CYCLE', modulePath: 'src/a.virune', cycle: ['src/a.virune', 'src/b.virune'] },
		{ code: 'SELF_IMPORT', modulePath: 'src/b.virune', specifier: './b' },
	]);
});

test('malformed graph requests are rejected before semantic evaluation', () => {
	assert.throws(() => buildCanonicalModuleGraph({ version: 2, entryPath: 'a.virune', modules: [] }), ModuleGraphContractError);
	assert.throws(() => buildCanonicalModuleGraph({
		version: 1,
		entryPath: 'a.virune',
		modules: [{ path: 'a.virune', imports: [], extra: true }],
	}), /unknown property/u);
	assert.throws(() => buildCanonicalModuleGraph({
		version: 1,
		entryPath: 'a.virune',
		modules: [
			{ path: 'a.virune', imports: [] },
			{ path: './a.virune', imports: [] },
		],
	}), /duplicate module path/u);
	assert.throws(() => buildCanonicalModuleGraph({
		version: 1,
		entryPath: 'a.virune',
		modules: [{
			path: 'a.virune',
			imports: [{ specifier: './b', sourceKind: 'virune', typeOnly: false, public: false }],
		}],
	}), /require a resolvedPath/u);
});
