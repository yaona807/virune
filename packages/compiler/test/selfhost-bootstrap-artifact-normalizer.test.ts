import assert from 'node:assert/strict';
import test from 'node:test';
import {
	BOOTSTRAP_ARTIFACT_POLICY_VERSION,
	diffBootstrapArtifacts,
	normalizeBootstrapArtifact,
	type BootstrapArtifactInput,
} from '../src/selfhost/bootstrap-artifact-normalizer.js';

const aHash = 'a'.repeat(64);
const bHash = 'b'.repeat(64);

test('equivalent artifacts normalize identically across roots, path separators, ordering, and run metadata', () => {
	const windows = normalizeBootstrapArtifact(artifact({
		root: 'C:\\work\\virune',
		separator: '\\',
		generatedAt: '2026-07-31T10:00:00Z',
		runId: 'windows-1',
		reverse: true,
		lineEnding: '\r\n',
	}));
	const posix = normalizeBootstrapArtifact(artifact({
		root: '/workspace/virune',
		separator: '/',
		generatedAt: '2026-07-31T11:00:00Z',
		runId: 'linux-9',
		reverse: false,
		lineEnding: '\n',
	}));

	assert.equal(windows.serialized, posix.serialized);
	assert.equal(windows.sha256, posix.sha256);
	assert.deepEqual(windows.artifact.moduleOrder, ['dist/a.js', 'dist/b.js']);
	assert.deepEqual(windows.artifact.modules[0]?.exports, ['alpha', 'zeta']);
	assert.deepEqual(windows.artifact.policy.ignoredMetadataFields, ['generatedAt', 'runId']);
	assert.equal('generatedAt' in windows.artifact.metadata, false);
	assert.equal('runId' in windows.artifact.metadata, false);
	assert.equal(diffBootstrapArtifacts(windows, posix).equal, true);
});

test('meaningful JavaScript and metadata differences are retained with field-level locations', () => {
	const beforeInput = artifact({
		root: '/workspace/virune',
		separator: '/',
		generatedAt: 'before',
		runId: '1',
		reverse: false,
		lineEnding: '\n',
	});
	const afterInput: BootstrapArtifactInput = {
		...beforeInput,
		modules: beforeInput.modules.map(module => module.path.endsWith('/a.js')
			? { ...module, code: 'export const value = 2;\n' }
			: module),
		metadata: { ...beforeInput.metadata, compilerVersion: '1.0.1' },
	};
	const before = normalizeBootstrapArtifact(beforeInput);
	const after = normalizeBootstrapArtifact(afterInput);
	const diff = diffBootstrapArtifacts(before, after);

	assert.equal(diff.equal, false);
	assert.notEqual(diff.beforeSha256, diff.afterSha256);
	assert.ok(diff.changes.some(change => change.section === 'modules' && change.path.endsWith('.code')));
	assert.ok(diff.changes.some(change => change.section === 'metadata'
		&& change.path === 'metadata.compilerVersion'));
});

test('duplicate canonical module paths are rejected', () => {
	const input = artifact({
		root: '/workspace/virune',
		separator: '/',
		generatedAt: 'now',
		runId: '1',
		reverse: false,
		lineEnding: '\n',
	});
	assert.throws(() => normalizeBootstrapArtifact({
		...input,
		modules: [
			input.modules[0]!,
			{ ...input.modules[0]!, path: '/workspace/virune/dist/./a.js' },
		],
	}), /Duplicate module paths/u);
});

test('unsupported policy versions and malformed checksums fail explicitly', () => {
	const input = artifact({
		root: '/workspace/virune',
		separator: '/',
		generatedAt: 'now',
		runId: '1',
		reverse: false,
		lineEnding: '\n',
	});
	assert.throws(() => normalizeBootstrapArtifact({ ...input, policyVersion: 2 }), /Unsupported/u);
	assert.throws(() => normalizeBootstrapArtifact({
		...input,
		checksumManifest: [{ path: '/workspace/virune/dist/a.js', sha256: 'not-a-hash' }],
	}), /Invalid SHA-256/u);
});

test('non-allowlisted metadata is never discarded implicitly', () => {
	const input = artifact({
		root: '/workspace/virune',
		separator: '/',
		generatedAt: 'now',
		runId: '1',
		reverse: false,
		lineEnding: '\n',
	});
	const before = normalizeBootstrapArtifact(input);
	const after = normalizeBootstrapArtifact({
		...input,
		metadata: { ...input.metadata, workerId: 'worker-2' },
	});
	const diff = diffBootstrapArtifacts(before, after);
	assert.equal(diff.equal, false);
	assert.ok(diff.changes.some(change => change.path === 'metadata.workerId'
		&& change.before === '<missing>'
		&& change.after === '"worker-2"'));
});

function artifact(options: {
	readonly root: string;
	readonly separator: '\\' | '/';
	readonly generatedAt: string;
	readonly runId: string;
	readonly reverse: boolean;
	readonly lineEnding: '\r\n' | '\n';
}): BootstrapArtifactInput {
	const path = (relative: string): string => `${options.root}${options.separator}${relative.replaceAll('/', options.separator)}`;
	const modules = [
		{
			path: path('dist/a.js'),
			code: `export const value = 1;${options.lineEnding}`,
			sourceMap: {
				version: 3,
				names: [],
				mappings: 'AAAA',
				file: path('dist/a.js'),
				sources: [path('src/a.virune')],
				sourcesContent: ['pub const value = 1'],
			},
			exports: ['zeta', 'alpha'],
		},
		{
			path: path('dist/b.js'),
			code: `export const other = true;${options.lineEnding}`,
			sourceMap: {
				sourcesContent: ['pub const other = true'],
				sources: [path('src/b.virune')],
				file: path('dist/b.js'),
				mappings: 'AAAA',
				names: [],
				version: 3,
			},
			exports: ['other'],
		},
	] as const;
	const checksums = [
		{ path: path('dist/a.js'), sha256: aHash.toUpperCase() },
		{ path: path('dist/b.js'), sha256: bHash },
	] as const;
	return {
		policyVersion: BOOTSTRAP_ARTIFACT_POLICY_VERSION,
		root: options.root,
		modules: options.reverse ? [...modules].reverse() : modules,
		diagnosticsSchema: {
			type: 'object',
			properties: {
				severity: { enum: ['error', 'warning'] },
				code: { type: 'string' },
			},
			required: ['code', 'severity'],
		},
		metadata: {
			runtimeAbi: '1',
			compilerVersion: '1.0.0',
			generatedAt: options.generatedAt,
			runId: options.runId,
			platform: { node: '24', target: 'es2022' },
		},
		checksumManifest: options.reverse ? [...checksums].reverse() : checksums,
	};
}
