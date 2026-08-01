import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createKernelSourceManifest,
	validateKernelSourceManifest,
	verifyKernelSourceManifest,
	type KernelInputV1,
} from '../src/selfhost/source-manifest.js';

test('equivalent source inputs produce one canonical manifest and hash', () => {
	const windows = createKernelSourceManifest(input({
		entryPath: 'src\\main.virune',
		reverse: true,
		lineEnding: '\r\n',
	}));
	const posix = createKernelSourceManifest(input({
		entryPath: './src/main.virune',
		reverse: false,
		lineEnding: '\n',
	}));

	assert.equal(windows.serialized, posix.serialized);
	assert.equal(windows.sha256, posix.sha256);
	assert.equal(windows.manifest.entryPath, 'src/main.virune');
	assert.deepEqual(windows.manifest.sources.map(source => source.path), [
		'src/lib/value.virune',
		'src/main.virune',
	]);
	assert.equal(windows.manifest.sources[1]?.lineCount, 3);
});

test('source changes are detected at the source entry and project manifest levels', () => {
	const beforeInput = input({ entryPath: 'src/main.virune', reverse: false, lineEnding: '\n' });
	const before = createKernelSourceManifest(beforeInput);
	const afterInput: KernelInputV1 = {
		...beforeInput,
		sources: beforeInput.sources.map(source => source.path.endsWith('main.virune')
			? { ...source, text: source.text.replace('value()', 'changed()') }
			: source),
	};
	const after = createKernelSourceManifest(afterInput);

	assert.notEqual(before.sha256, after.sha256);
	assert.notEqual(before.manifest.sources[1]?.sourceSha256, after.manifest.sources[1]?.sourceSha256);
	assert.throws(
		() => verifyKernelSourceManifest(before.manifest, afterInput),
		/\$\.sources\[1\]\.sourceSha256: expected/u,
	);
});

test('manifest validation rejects non-canonical order, paths, hashes, and unknown fields', () => {
	const canonical = createKernelSourceManifest(input({ entryPath: 'src/main.virune', reverse: false, lineEnding: '\n' }));
	assert.throws(() => validateKernelSourceManifest({
		...canonical.manifest,
		sources: [...canonical.manifest.sources].reverse(),
	}), /strictly ordered/u);
	assert.throws(() => validateKernelSourceManifest({
		...canonical.manifest,
		sources: canonical.manifest.sources.map((source, index) => index === 0
			? { ...source, path: `./${source.path}` }
			: source),
	}), /path must be canonical/u);
	assert.throws(() => validateKernelSourceManifest({
		...canonical.manifest,
		sources: canonical.manifest.sources.map((source, index) => index === 0
			? { ...source, sourceSha256: source.sourceSha256.toUpperCase() }
			: source),
	}), /lowercase SHA-256/u);
	assert.throws(() => validateKernelSourceManifest({ ...canonical.manifest, generatedAt: 'now' }), /unknown property/u);
});

test('verification binds the manifest to its canonical SHA and Kernel input', () => {
	const kernelInput = input({ entryPath: 'src/main.virune', reverse: false, lineEnding: '\n' });
	const result = createKernelSourceManifest(kernelInput);
	assert.equal(verifyKernelSourceManifest(result.manifest, kernelInput, result.sha256).sha256, result.sha256);
	assert.throws(
		() => verifyKernelSourceManifest(result.manifest, kernelInput, '0'.repeat(64)),
		/\$expectedSha256: expected/u,
	);
	assert.throws(
		() => verifyKernelSourceManifest({ ...result.manifest, platform: 'browser' }, kernelInput),
		/\$\.platform: expected "node"/u,
	);
});

function input(options: {
	readonly entryPath: string;
	readonly reverse: boolean;
	readonly lineEnding: '\r\n' | '\n';
}): KernelInputV1 {
	const sources = [
		{
			path: 'src/main.virune',
			text: `import { value } from "./lib/value"${options.lineEnding}${options.lineEnding}pub fn main() -> Int { value() }`,
		},
		{
			path: 'src\\lib\\value.virune',
			text: `pub fn value() -> Int {${options.lineEnding}\t1${options.lineEnding}}`,
		},
	] as const;
	return {
		contractVersion: '1',
		languageVersion: '1.0',
		platform: 'node',
		entryPath: options.entryPath,
		sources: options.reverse ? [...sources].reverse() : sources,
		interopManifest: { version: '1', modules: [] },
		emit: { target: 'es2022', sourceMap: true, sourcesContent: true },
	};
}
