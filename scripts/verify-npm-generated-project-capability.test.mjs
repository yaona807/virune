import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import test from 'node:test';
import {
	NPM_GENERATED_PROJECT_CAPABILITY_KIND,
	NPM_GENERATED_PROJECT_CAPABILITY_TAR_PATH,
	PUBLIC_NPM_REGISTRY,
	buildNpmGeneratedProjectCapability,
	canonicalNpmGeneratedProjectCapabilityBytes,
	validateNpmGeneratedProjectCapability,
} from './npm-generated-project-capability.mjs';
import { verifyNpmGeneratedProjectCapabilityTarball } from './verify-npm-generated-project-capability.mjs';

const tags = { stable: 'latest', prerelease: 'next', nightly: null };

function plan({
	stage = 'publication-candidate',
	publicationReady = true,
	currentVersion = '1.1.0-rc.1',
} = {}) {
	return {
		stage,
		publicationReady,
		currentVersion,
		firstStableRegistryRelease: '1.1.0',
		distTagPolicy: tags,
	};
}

function capability(version = '1.1.0-rc.1') {
	return {
		schemaVersion: 1,
		kind: NPM_GENERATED_PROJECT_CAPABILITY_KIND,
		version,
		registry: PUBLIC_NPM_REGISTRY,
		dependencySource: 'npm',
	};
}

test('capability is emitted only for a reviewed Registry-eligible publication candidate', () => {
	assert.deepEqual(buildNpmGeneratedProjectCapability(plan()), capability());
	assert.equal(buildNpmGeneratedProjectCapability(plan({ stage: 'prepublication-audit', publicationReady: false, currentVersion: '1.0.0' })), null);
	assert.throws(() => buildNpmGeneratedProjectCapability(plan({ stage: 'publication-candidate', publicationReady: false })), /publicationReady:true/u);
	assert.throws(() => buildNpmGeneratedProjectCapability(plan({ stage: 'prepublication-audit', publicationReady: true, currentVersion: '1.0.0' })), /must not claim publication readiness/u);
	assert.throws(() => buildNpmGeneratedProjectCapability(plan({ currentVersion: '1.0.0' })), /must be Registry-eligible/u);
	assert.throws(() => buildNpmGeneratedProjectCapability({ ...plan(), stage: 'unknown' }), /expected one of/u);
});

test('capability schema is exact version and public-Registry bound', () => {
	assert.deepEqual(validateNpmGeneratedProjectCapability(capability(), '1.1.0-rc.1'), capability());
	const mutations = [
		value => { value.schemaVersion = 2; },
		value => { value.kind = 'unknown'; },
		value => { value.version = '1.1.0-rc.2'; },
		value => { value.registry = 'https://registry.example.invalid/'; },
		value => { value.dependencySource = 'github-release'; },
		value => { value.unexpected = true; },
	];
	for (const mutate of mutations) {
		const value = capability();
		mutate(value);
		assert.throws(() => validateNpmGeneratedProjectCapability(value, '1.1.0-rc.1'));
	}
});

test('candidate verifier requires canonical capability bytes when authorized', () => {
	const expected = capability();
	const bytes = canonicalNpmGeneratedProjectCapabilityBytes(expected);
	const tarball = registryCliTarball([[NPM_GENERATED_PROJECT_CAPABILITY_TAR_PATH, bytes]]);
	assert.deepEqual(verifyNpmGeneratedProjectCapabilityTarball(tarball, plan()), {
		present: true,
		capability: expected,
	});

	const nonCanonical = registryCliTarball([[NPM_GENERATED_PROJECT_CAPABILITY_TAR_PATH, JSON.stringify(expected)]]);
	assert.throws(() => verifyNpmGeneratedProjectCapabilityTarball(nonCanonical, plan()), /canonical deterministic JSON encoding/u);
	assert.throws(() => verifyNpmGeneratedProjectCapabilityTarball(registryCliTarball([]), plan()), /must be a regular file/u);
});

test('candidate verifier binds both CLI runtime entries to the exact reviewed version', () => {
	const bytes = canonicalNpmGeneratedProjectCapabilityBytes(capability());
	const staleCore = registryCliTarball([
		['package/dist/src/main-core.js', 'const VERSION = "1.1.0-rc.2";\n'],
		[NPM_GENERATED_PROJECT_CAPABILITY_TAR_PATH, bytes],
	], '1.1.0-rc.1', { omitDefaultCore: true });
	assert.throws(() => verifyNpmGeneratedProjectCapabilityTarball(staleCore, plan()), /main-core\.js.*does not match 1\.1\.0-rc\.1/u);

	const missingCore = registryCliTarball([
		[NPM_GENERATED_PROJECT_CAPABILITY_TAR_PATH, bytes],
	], '1.1.0-rc.1', { omitDefaultCore: true });
	assert.throws(() => verifyNpmGeneratedProjectCapabilityTarball(missingCore, plan()), /main-core\.js must be a regular file/u);
});

test('prepublication audit rejects an unexpected capability instead of treating it as safe', () => {
	const auditPlan = plan({ stage: 'prepublication-audit', publicationReady: false, currentVersion: '1.0.0' });
	assert.deepEqual(verifyNpmGeneratedProjectCapabilityTarball(registryCliTarball([], '1.0.0'), auditPlan), {
		present: false,
		version: '1.0.0',
	});
	const unexpected = canonicalNpmGeneratedProjectCapabilityBytes(capability('1.1.0-rc.1'));
	assert.throws(
		() => verifyNpmGeneratedProjectCapabilityTarball(registryCliTarball([[NPM_GENERATED_PROJECT_CAPABILITY_TAR_PATH, unexpected]], '1.0.0'), auditPlan),
		/capability must be absent/u,
	);
});

function registryCliTarball(extraEntries, version = '1.1.0-rc.1', { omitDefaultCore = false } = {}) {
	return gzipSync(buildTar([
		['package/package.json', `${JSON.stringify({ name: 'virune', version })}\n`],
		['package/dist/src/main.js', `const VERSION = ${JSON.stringify(version)};\n`],
		...(!omitDefaultCore ? [['package/dist/src/main-core.js', `const VERSION = ${JSON.stringify(version)};\n`]] : []),
		...extraEntries,
	]));
}

function buildTar(entries) {
	const chunks = [];
	for (const [name, value] of entries) {
		const content = Buffer.isBuffer(value) ? value : Buffer.from(value);
		const header = Buffer.alloc(512);
		Buffer.from(name).copy(header, 0, 0, 100);
		header.write(`${content.byteLength.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii');
		header[156] = '0'.charCodeAt(0);
		header.fill(0x20, 148, 156);
		const checksum = header.reduce((total, byte) => total + byte, 0);
		header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
		chunks.push(header, content);
		const padding = (512 - content.byteLength % 512) % 512;
		if (padding > 0) chunks.push(Buffer.alloc(padding));
	}
	chunks.push(Buffer.alloc(1024));
	return Buffer.concat(chunks);
}
