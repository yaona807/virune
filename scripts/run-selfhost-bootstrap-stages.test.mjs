import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import './run-selfhost-clean-bootstrap.test.mjs';
import {
	createBootstrapEvidence,
	helpText,
	parseArguments,
	resolveCachePath,
	resolveRepositoryPath,
} from './run-selfhost-bootstrap-stages.mjs';

const capability = {
	contractVersion: '1',
	ready: true,
	requestSchema: 'request',
	resultSchema: 'result',
	blockers: [],
};

function readiness({ ready = true, blockers = [], capabilityBlockers = [] } = {}) {
	return {
		sha256: 'a'.repeat(64),
		evidence: {
			policyVersion: 3,
			claim: 'stage1-stage2-bootstrap-readiness',
			productionEligible: false,
			ready,
			compilerArtifactSha256: 'b'.repeat(64),
			sourceManifestSha256: 'c'.repeat(64),
			sourceCount: 31,
			entryPath: 'src/main.virune',
			requiredExports: ['projectCompilerCapability', 'compileProjectMvp'],
			capability: { ...capability, ready, blockers: capabilityBlockers },
			capabilitySha256: 'd'.repeat(64),
			capabilityReady: ready,
			capabilityBlockers,
			blockers,
		},
	};
}

function execution({ equivalent, differences = [] }) {
	return {
		stage1: { sha256: '1'.repeat(64), modules: [{ outputPath: 'dist/main.js' }] },
		stage2: { sha256: equivalent ? '1'.repeat(64) : '2'.repeat(64), modules: [{ outputPath: 'dist/main.js' }] },
		equivalent,
		differences,
	};
}

test('bootstrap CLI parses its bounded option surface', () => {
	assert.deepEqual(parseArguments([]), {
		help: false,
		json: false,
		output: '.cache/selfhost/bootstrap-stages.json',
		project: 'selfhost/mvp',
		temporaryRoot: '.cache/selfhost/bootstrap-candidates',
	});
	assert.deepEqual(parseArguments([
		'--json',
		'--project=selfhost/custom',
		'--output=.cache/custom.json',
		'--temporary-root=.cache/candidates',
	]), {
		help: false,
		json: true,
		output: '.cache/custom.json',
		project: 'selfhost/custom',
		temporaryRoot: '.cache/candidates',
	});
});

test('bootstrap CLI rejects ambiguous and unsupported options', () => {
	assert.throws(() => parseArguments(['--json', '--json']), /Duplicate option/);
	assert.throws(() => parseArguments(['--project=a', '--project=b']), /Duplicate option/);
	assert.throws(() => parseArguments(['--help', '--json']), /cannot be combined/);
	assert.throws(() => parseArguments(['--stage=stage1']), /Unknown argument/);
});

test('bootstrap paths stay inside the repository and evidence stays in cache', () => {
	const root = resolve('/tmp/virune');
	assert.deepEqual(resolveRepositoryPath(root, 'selfhost/mvp', '--project'), {
		absolutePath: resolve(root, 'selfhost/mvp'),
		repositoryRelative: 'selfhost/mvp',
	});
	assert.deepEqual(resolveCachePath(root, '.cache/result.json', '--output', '.json'), {
		absolutePath: resolve(root, '.cache/result.json'),
		repositoryRelative: '.cache/result.json',
	});
	assert.throws(() => resolveRepositoryPath(root, '../outside', '--project'), /inside the repository/);
	assert.throws(() => resolveCachePath(root, 'result.json', '--output', '.json'), /inside \.cache/);
	assert.throws(() => resolveCachePath(root, '.cache/result.txt', '--output', '.json'), /end in \.json/);
});

test('bootstrap evidence distinguishes blocked, matching, and mismatching results', () => {
	const blocked = createBootstrapEvidence(readiness({
		ready: false,
		blockers: ['project-compiler-not-ready'],
		capabilityBlockers: ['full-language-inventory-incomplete'],
	}));
	assert.equal(blocked.status, 'blocked');
	assert.equal(blocked.stage1, null);
	assert.equal(blocked.productionEligible, false);

	const matching = createBootstrapEvidence(readiness(), execution({ equivalent: true }));
	assert.equal(matching.status, 'match');
	assert.equal(matching.equivalent, true);
	assert.equal(matching.stage1.moduleCount, 1);
	assert.equal(matching.stage2.moduleCount, 1);

	const differences = [{ section: 'module', path: 'dist/main.js', stage1Sha256: '1', stage2Sha256: '2' }];
	const mismatching = createBootstrapEvidence(readiness(), execution({ equivalent: false, differences }));
	assert.equal(mismatching.status, 'mismatch');
	assert.deepEqual(mismatching.differences, differences);
});

test('help documents evidence-before-failure behavior', () => {
	assert.match(helpText(), /writes deterministic JSON evidence/);
	assert.match(helpText(), /fail after evidence is written/);
});
