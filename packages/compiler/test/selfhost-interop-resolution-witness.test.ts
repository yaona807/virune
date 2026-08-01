import assert from 'node:assert/strict';
import test from 'node:test';
import {
	INTEROP_RESOLUTION_WITNESS_VERSION,
	InteropResolutionWitnessError,
	serializeInteropResolutionWitness,
	validateInteropResolutionWitness,
	type InteropResolutionExpectation,
} from '../src/selfhost/interop-resolution-witness.js';

const candidateSha = 'a'.repeat(40);
const sourceManifestSha256 = 'b'.repeat(64);
const artifactSha256 = 'c'.repeat(64);
const typeSnapshotSha256 = 'd'.repeat(64);

const expectation: InteropResolutionExpectation = {
	contractVersion: '1',
	platform: 'node',
	candidateSha,
	sourceManifestSha256,
	specifiers: ['node:fs', 'pkg'],
};

test('resolution witnesses normalize ordering, relative paths, URLs, and hash casing', () => {
	const input = {
		version: INTEROP_RESOLUTION_WITNESS_VERSION,
		contractVersion: '1',
		platform: 'node',
		candidateSha: candidateSha.toUpperCase(),
		sourceManifestSha256: sourceManifestSha256.toUpperCase(),
		modules: [
			{
				specifier: 'pkg',
				resolutionKind: 'relative',
				resolvedId: './adapters\\pkg.js',
				runtimeFormat: 'esm',
				artifactSha256: artifactSha256.toUpperCase(),
				typeSnapshotSha256: typeSnapshotSha256.toUpperCase(),
			},
			{
				specifier: 'node:fs',
				resolutionKind: 'builtin',
				resolvedId: 'node:fs',
				runtimeFormat: 'esm',
				artifactSha256: null,
				typeSnapshotSha256,
			},
		],
	};
	const first = validateInteropResolutionWitness(input, expectation);
	const second = validateInteropResolutionWitness({ ...input, modules: [...input.modules].reverse() }, expectation);

	assert.deepEqual(first, second);
	assert.deepEqual(first.modules.map(module => module.specifier), ['node:fs', 'pkg']);
	assert.equal(first.modules[1]?.resolvedId, 'adapters/pkg.js');
	assert.equal(first.candidateSha, candidateSha);
	assert.equal(first.sourceManifestSha256, sourceManifestSha256);
	assert.equal(first.modules[1]?.artifactSha256, artifactSha256);
	assert.equal(serializeInteropResolutionWitness(first), serializeInteropResolutionWitness(second));
});

test('candidate, source manifest, and platform mismatches fail as stale evidence', () => {
	const witness = validWitness();
	assert.throws(() => validateInteropResolutionWitness({ ...witness, candidateSha: 'e'.repeat(40) }, expectation), /stale candidate SHA/u);
	assert.throws(() => validateInteropResolutionWitness({ ...witness, sourceManifestSha256: 'e'.repeat(64) }, expectation), /stale source manifest/u);
	assert.throws(() => validateInteropResolutionWitness({ ...witness, platform: 'browser' }, expectation), /stale platform/u);
});

test('missing, unexpected, and duplicate module evidence fails closed', () => {
	const witness = validWitness();
	assert.throws(() => validateInteropResolutionWitness({ ...witness, modules: witness.modules.slice(0, 1) }, expectation), /missing specifiers/u);
	assert.throws(() => validateInteropResolutionWitness({
		...witness,
		modules: [...witness.modules, {
			specifier: 'other',
			resolutionKind: 'package',
			resolvedId: 'other/index.js',
			runtimeFormat: 'commonjs',
			artifactSha256,
			typeSnapshotSha256,
		}],
	}, expectation), /unexpected specifiers/u);
	assert.throws(() => validateInteropResolutionWitness({
		...witness,
		modules: [...witness.modules, witness.modules[0]],
	}, expectation), /duplicate specifier/u);
});

test('resolution-kind invariants and unknown properties are rejected', () => {
	const witness = validWitness();
	assert.throws(() => validateInteropResolutionWitness({
		...witness,
		modules: witness.modules.map(module => module.specifier === 'node:fs'
			? { ...module, artifactSha256 }
			: module),
	}, expectation), /builtin modules must use null/u);
	assert.throws(() => validateInteropResolutionWitness({
		...witness,
		modules: witness.modules.map(module => module.specifier === 'pkg'
			? { ...module, artifactSha256: null }
			: module),
	}, expectation), /non-builtin modules require/u);
	assert.throws(() => validateInteropResolutionWitness({ ...witness, extra: true }, expectation), InteropResolutionWitnessError);
	assert.throws(() => validateInteropResolutionWitness({
		...witness,
		modules: witness.modules.map(module => module.specifier === 'pkg'
			? { ...module, resolutionKind: 'url', resolvedId: 'http://example.com/pkg.js' }
			: module),
	}, expectation), /credential-free HTTPS/u);
});

function validWitness() {
	return {
		version: INTEROP_RESOLUTION_WITNESS_VERSION,
		contractVersion: '1',
		platform: 'node',
		candidateSha,
		sourceManifestSha256,
		modules: [
			{
				specifier: 'node:fs',
				resolutionKind: 'builtin',
				resolvedId: 'node:fs',
				runtimeFormat: 'esm',
				artifactSha256: null,
				typeSnapshotSha256,
			},
			{
				specifier: 'pkg',
				resolutionKind: 'relative',
				resolvedId: 'adapters/pkg.js',
				runtimeFormat: 'esm',
				artifactSha256,
				typeSnapshotSha256,
			},
		],
	} as const;
}
