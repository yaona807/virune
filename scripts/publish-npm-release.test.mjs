import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import {
	NPM_INTERNAL_DEPENDENCIES,
	NPM_PUBLICATION_ORDER,
	assertNoTraditionalNpmCredentials,
	assertTrustedPublishingEnvironment,
	executePublication,
	isolatedNpmEnvironment,
	npmPublishArguments,
	observeRegistryCandidate,
	orderedPublicationCandidates,
	validateObservedDependencyClosure,
	validateTrustedPublishingProvenance,
	verifyCandidateTarballAtWriteBoundary,
	verifyTrustedPublishingToolchain,
} from './publish-npm-release.mjs';

const COMMIT = 'a'.repeat(40);
const VERSION = '1.1.0-rc.1';
const candidates = NPM_PUBLICATION_ORDER.map(registryName => ({
	registryName,
	releaseAsset: `${registryName.replaceAll('@', '').replaceAll('/', '-')}.tgz`,
	sha256: 'b'.repeat(64),
	bytes: 123,
}));

test('publication order is the exact dependency-safe package set with CLI last', () => {
	const shuffled = [...candidates].reverse();
	assert.deepEqual(orderedPublicationCandidates(shuffled).map(item => item.registryName), NPM_PUBLICATION_ORDER);
	assert.equal(NPM_PUBLICATION_ORDER.at(-1), 'virune');
	assert.throws(() => orderedPublicationCandidates(candidates.slice(1)), /unexpected Registry package count/u);
});

test('publication dependency model and order match the reviewed workspace manifests', () => {
	const manifests = new Map();
	for (const entry of readdirSync(resolve('packages'), { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const manifestPath = resolve('packages', entry.name, 'package.json');
		let manifest;
		try {
			manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
		} catch {
			continue;
		}
		manifests.set(manifest.name, manifest);
	}
	const publicationNames = new Set(NPM_PUBLICATION_ORDER);
	const position = new Map(NPM_PUBLICATION_ORDER.map((name, index) => [name, index]));
	for (const name of NPM_PUBLICATION_ORDER) {
		const manifest = manifests.get(name);
		assert.ok(manifest, `missing workspace manifest for ${name}`);
		const dependencies = new Set();
		for (const section of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
			for (const dependency of Object.keys(manifest[section] ?? {})) {
				if (publicationNames.has(dependency)) dependencies.add(dependency);
			}
		}
		const actual = [...dependencies].sort();
		const modeled = [...NPM_INTERNAL_DEPENDENCIES[name]].sort();
		assert.deepEqual(modeled, actual, `${name} publication dependency model drifted from package.json`);
		for (const dependency of actual) {
			assert(position.get(dependency) < position.get(name), `${dependency} must publish before ${name}`);
		}
	}
});

test('exact observations must be dependency-closed before any write', () => {
	const valid = new Map(NPM_PUBLICATION_ORDER.map(name => [name, { state: 'missing' }]));
	valid.set('@virune/runtime', { state: 'exact' });
	valid.set('@virune/stdlib', { state: 'exact' });
	assert.equal(validateObservedDependencyClosure(valid), true);

	const invalid = new Map(valid);
	invalid.set('@virune/compiler', { state: 'exact' });
	invalid.set('@virune/runtime', { state: 'missing' });
	assert.throws(() => validateObservedDependencyClosure(invalid), /exact package requires exact dependency @virune\/runtime/u);
});

test('complete Registry observation happens before provenance checks or writes', async () => {
	const events = [];
	await assert.rejects(
		executePublication({ version: VERSION }, candidates, {
			observe: async candidate => {
				events.push(`observe:${candidate.registryName}`);
				if (candidate.registryName === '@virune/formatter') throw new Error('Registry unavailable');
				return { state: 'missing' };
			},
			verifyProvenance: async candidate => events.push(`provenance:${candidate.registryName}`),
			publish: async candidate => events.push(`publish:${candidate.registryName}`),
		}),
		/Registry unavailable/u,
	);
	assert.equal(events.some(event => event.startsWith('publish:')), false);
	assert.equal(events.some(event => event.startsWith('provenance:')), false);
});

test('exact subset is verified first and only missing candidates are published in canonical order', async () => {
	const state = new Map(NPM_PUBLICATION_ORDER.map(name => [name, 'missing']));
	state.set('@virune/runtime', 'exact');
	state.set('@virune/stdlib', 'exact');
	const publishes = [];
	const provenance = [];
	const result = await executePublication({ version: VERSION }, candidates, {
		observe: async candidate => ({ state: state.get(candidate.registryName) }),
		verifyProvenance: async candidate => provenance.push(candidate.registryName),
		publish: async candidate => {
			for (const dependency of NPM_INTERNAL_DEPENDENCIES[candidate.registryName]) assert.equal(state.get(dependency), 'exact');
			publishes.push(candidate.registryName);
			state.set(candidate.registryName, 'exact');
		},
	});
	assert.deepEqual(publishes, ['@virune/compiler', '@virune/formatter', '@virune/js-interop', 'virune']);
	assert.deepEqual(result.skipped, ['@virune/runtime', '@virune/stdlib']);
	assert.deepEqual(result.published, publishes);
	assert.deepEqual(provenance, [
		'@virune/runtime', '@virune/stdlib',
		...publishes,
		...NPM_PUBLICATION_ORDER,
	]);
});

test('unknown post-publish observation stops before the next package write', async () => {
	const state = new Map(NPM_PUBLICATION_ORDER.map(name => [name, 'missing']));
	const publishes = [];
	let initialObservations = NPM_PUBLICATION_ORDER.length;
	await assert.rejects(
		executePublication({ version: VERSION }, candidates, {
			observe: async candidate => {
				if (initialObservations > 0) {
					initialObservations -= 1;
					return { state: state.get(candidate.registryName) };
				}
				throw new Error('post-publish Registry state unknown');
			},
			verifyProvenance: async () => {},
			publish: async candidate => { publishes.push(candidate.registryName); state.set(candidate.registryName, 'exact'); },
		}),
		/post-publish Registry state unknown/u,
	);
	assert.deepEqual(publishes, ['@virune/runtime']);
});

test('final complete-set observation rejects Registry drift before publication completion', async () => {
	let observations = 0;
	await assert.rejects(
		executePublication({ version: VERSION }, candidates, {
			observe: async candidate => {
				observations += 1;
				const finalPass = observations > NPM_PUBLICATION_ORDER.length;
				return { state: finalPass && candidate.registryName === 'virune' ? 'missing' : 'exact' };
			},
			verifyProvenance: async () => {},
			publish: async () => assert.fail('all packages were initially exact'),
		}),
		/final complete-set Registry observation is not exact/u,
	);
	assert.equal(observations, NPM_PUBLICATION_ORDER.length * 2);
});

test('Registry probing treats 404 as missing but rejects contradictory and unknown states', async () => {
	const candidate = candidates[0];
	const missing = await observeRegistryCandidate(candidate, VERSION, 'next', {
		fetchImpl: async url => response(url.includes(encodeURIComponent(VERSION)) ? 404 : 200, url.includes(encodeURIComponent(VERSION)) ? null : {
			name: candidate.registryName,
			versions: { '1.0.0': {} },
			'dist-tags': { latest: '1.0.0' },
		}),
	});
	assert.deepEqual(missing, { state: 'missing' });

	await assert.rejects(
		observeRegistryCandidate(candidate, VERSION, 'next', {
			fetchImpl: async url => response(url.includes(encodeURIComponent(VERSION)) ? 404 : 200, url.includes(encodeURIComponent(VERSION)) ? null : {
				name: candidate.registryName,
				versions: { [VERSION]: {} },
				'dist-tags': { next: VERSION },
			}),
		}),
		/version endpoint is missing while packument contains the target version/u,
	);

	await assert.rejects(
		observeRegistryCandidate(candidate, VERSION, 'next', { fetchImpl: async () => response(503, {}) }),
		/HTTP 503/u,
	);

	await assert.rejects(
		observeRegistryCandidate(candidate, VERSION, 'next', {
			fetchImpl: async url => response(url.includes(encodeURIComponent(VERSION)) ? 404 : 200, url.includes(encodeURIComponent(VERSION)) ? null : {
				name: candidate.registryName,
				'dist-tags': {},
			}),
		}),
		/packument\.versions: expected an object/u,
	);
});

test('missing target refuses stale canonical tag downgrade and malformed tag state', async () => {
	const candidate = candidates[0];
	const observeMissingWithPackument = packument => observeRegistryCandidate(candidate, VERSION, 'next', {
		fetchImpl: async url => response(url.includes(encodeURIComponent(VERSION)) ? 404 : 200, url.includes(encodeURIComponent(VERSION)) ? null : {
			name: candidate.registryName,
			...packument,
		}),
	});

	assert.deepEqual(await observeMissingWithPackument({
		versions: { '1.1.0-beta.2': {} },
		'dist-tags': { next: '1.1.0-beta.2' },
	}), { state: 'missing' });

	await assert.rejects(
		observeMissingWithPackument({
			versions: { '1.1.0': {} },
			'dist-tags': { next: '1.1.0' },
		}),
		/canonical tag target 1\.1\.0 is not older than publication target 1\.1\.0-rc\.1/u,
	);

	await assert.rejects(
		observeMissingWithPackument({
			versions: { '1.0.0': {} },
			'dist-tags': { next: '1.0.1' },
		}),
		/canonical tag target 1\.0\.1 is absent from packument versions/u,
	);

	await assert.rejects(
		observeMissingWithPackument({
			versions: { '1.0.0-nightly.20260823.1': {} },
			'dist-tags': { next: '1.0.0-nightly.20260823.1' },
		}),
		/expected stable, alpha, beta, or rc Virune semantic version/u,
	);

	const stable = await observeRegistryCandidate(candidate, '1.1.0', 'latest', {
		fetchImpl: async url => response(url.includes(encodeURIComponent('1.1.0')) ? 404 : 200, url.includes(encodeURIComponent('1.1.0')) ? null : {
			name: candidate.registryName,
			versions: { '1.1.0-rc.9': {} },
			'dist-tags': { latest: '1.1.0-rc.9' },
		}),
	});
	assert.deepEqual(stable, { state: 'missing' });
});

test('existing Registry package delegates exact bytes and tag verification to the canonical verifier', async () => {
	const candidate = candidates[0];
	let verified = 0;
	const observed = await observeRegistryCandidate(candidate, VERSION, 'next', {
		fetchImpl: async url => response(200, url.includes(encodeURIComponent(VERSION))
			? { name: candidate.registryName, version: VERSION }
			: { name: candidate.registryName, versions: { [VERSION]: {} }, 'dist-tags': { next: VERSION } }),
		verifyExisting: async (actual, version, tag) => {
			verified += 1;
			assert.equal(actual, candidate);
			assert.equal(version, VERSION);
			assert.equal(tag, 'next');
			return { sha256: candidate.sha256 };
		},
	});
	assert.equal(verified, 1);
	assert.equal(observed.state, 'exact');
});

test('normal publication forbids traditional npm credentials and requires the attestation-capable toolchain', () => {
	assert.equal(assertNoTraditionalNpmCredentials({ GITHUB_TOKEN: 'allowed', NPM_CONFIG_REGISTRY: 'https://registry.npmjs.org/' }), true);
	for (const env of [
		{ NPM_TOKEN: 'secret' },
		{ NODE_AUTH_TOKEN: 'secret' },
		{ NPM_CONFIG__AUTHTOKEN: 'secret' },
		{ npm_config__authToken: 'secret' },
	]) assert.throws(() => assertNoTraditionalNpmCredentials(env), /traditional npm publication credentials are forbidden/u);
	assert.equal(verifyTrustedPublishingToolchain({ nodeVersion: '24.7.0', npmVersion: '11.12.0' }), true);
	assert.throws(() => verifyTrustedPublishingToolchain({ nodeVersion: '22.13.9', npmVersion: '11.12.0' }), /requires >=22.14.0/u);
	assert.throws(() => verifyTrustedPublishingToolchain({ nodeVersion: '24.7.0', npmVersion: '11.11.9' }), /requires >=11.12.0/u);
});

test('Trusted Publishing environment is bound to the exact release workflow and ref', () => {
	const env = trustedPublishingEnvironment();
	assert.equal(assertTrustedPublishingEnvironment(env, COMMIT), true);
	for (const mutate of [
		value => { value.GITHUB_EVENT_NAME = 'workflow_dispatch'; },
		value => { value.GITHUB_WORKFLOW_REF = `yaona807/virune/.github/workflows/other.yml@${value.GITHUB_REF}`; },
		value => { value.GITHUB_WORKFLOW_REF = `yaona807/virune/.github/workflows/release.yml@refs/heads/other`; },
		value => { value.GITHUB_REPOSITORY = 'example/fork'; },
	]) {
		const altered = trustedPublishingEnvironment();
		mutate(altered);
		assert.throws(() => assertTrustedPublishingEnvironment(altered, COMMIT));
	}
});

test('publication npm environment removes ambient npm configuration and uses isolated public Registry state', () => {
	const root = mkdtempSync(join(tmpdir(), 'virune-npm-publish-env-'));
	try {
		const env = isolatedNpmEnvironment({
			PATH: '/usr/bin',
			HOME: '/ambient-home',
			XDG_CONFIG_HOME: '/ambient-xdg',
			NPM_CONFIG_REGISTRY: 'https://example.invalid/',
			npm_config_userconfig: '/ambient/npmrc',
			NPM_TOKEN: '',
		}, root);
		assert.equal(env.PATH, '/usr/bin');
		assert.equal(env.HOME, root);
		assert.equal(env.XDG_CONFIG_HOME, resolve(root, 'xdg-config'));
		assert.equal(env.NPM_CONFIG_REGISTRY, 'https://registry.npmjs.org/');
		assert.equal(env.NPM_CONFIG_USERCONFIG, resolve(root, 'user.npmrc'));
		assert.equal(env.NPM_CONFIG_GLOBALCONFIG, resolve(root, 'global.npmrc'));
		assert.equal(env.NPM_CONFIG_CACHE, resolve(root, 'cache'));
		assert.equal(Object.hasOwn(env, 'npm_config_userconfig'), false);
		assert.equal(Object.hasOwn(env, 'NPM_TOKEN'), false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('npm publish consumes the exact tarball and applies the canonical tag without rebuild or token fallback', () => {
	const args = npmPublishArguments('/tmp/release/virune-npm-1.1.0.tgz', 'latest');
	assert.deepEqual(args, [
		'publish',
		'/tmp/release/virune-npm-1.1.0.tgz',
		'--registry=https://registry.npmjs.org/',
		'--access=public',
		'--tag=latest',
		'--ignore-scripts',
	]);
	assert.equal(args.some(value => value.includes('pack') || value.includes('build') || value.includes('dist-tag')), false);
});

test('npm write boundary rejects changed or symlinked reviewed tarballs', () => {
	const root = mkdtempSync(join(tmpdir(), 'virune-npm-write-boundary-'));
	try {
		const tarball = resolve(root, 'candidate.tgz');
		const reviewedBytes = Buffer.from('reviewed exact tarball bytes');
		writeFileSync(tarball, reviewedBytes);
		const candidate = {
			registryName: '@virune/runtime',
			sha256: createHash('sha256').update(reviewedBytes).digest('hex'),
			bytes: reviewedBytes.byteLength,
		};
		assert.deepEqual(verifyCandidateTarballAtWriteBoundary(candidate, tarball), {
			sha256: candidate.sha256,
			bytes: candidate.bytes,
		});

		writeFileSync(tarball, Buffer.from('changed exact tarball bytes!'));
		assert.throws(
			() => verifyCandidateTarballAtWriteBoundary(candidate, tarball),
			/tarball changed after reviewed publication identity verification/u,
		);

		const actualBytes = Buffer.from('different length');
		writeFileSync(tarball, actualBytes);
		assert.throws(
			() => verifyCandidateTarballAtWriteBoundary({
				...candidate,
				sha256: createHash('sha256').update(actualBytes).digest('hex'),
			}, tarball),
			/tarball byte size changed after reviewed publication identity verification/u,
		);

		const target = resolve(root, 'target.tgz');
		writeFileSync(target, reviewedBytes);
		unlinkSync(tarball);
		symlinkSync(target, tarball);
		assert.throws(() => verifyCandidateTarballAtWriteBoundary(candidate, tarball));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('verified npm provenance must bind repository, workflow and exact reviewed commit', () => {
	const report = provenanceAudit(COMMIT);
	assert.equal(validateTrustedPublishingProvenance(report, { registryName: '@virune/runtime', version: VERSION, expectedCommit: COMMIT }), true);

	for (const mutate of [
		statement => { statement.predicate.buildDefinition.externalParameters.workflow.repository = 'https://github.com/example/fork'; },
		statement => { statement.predicate.buildDefinition.externalParameters.workflow.path = '.github/workflows/other.yml'; },
		statement => { statement.predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit = 'b'.repeat(40); },
		statement => { statement.predicate.runDetails.builder.id = 'https://example.invalid/runner'; },
	]) {
		const altered = provenanceAudit(COMMIT, mutate);
		assert.throws(() => validateTrustedPublishingProvenance(altered, { registryName: '@virune/runtime', version: VERSION, expectedCommit: COMMIT }));
	}
});

function trustedPublishingEnvironment() {
	const ref = 'refs/heads/release-candidate/v1.1.0-rc.1';
	return {
		GITHUB_ACTIONS: 'true',
		GITHUB_EVENT_NAME: 'push',
		RUNNER_ENVIRONMENT: 'github-hosted',
		GITHUB_REPOSITORY: 'yaona807/virune',
		GITHUB_SHA: COMMIT,
		GITHUB_REF: ref,
		GITHUB_WORKFLOW_REF: `yaona807/virune/.github/workflows/release.yml@${ref}`,
		ACTIONS_ID_TOKEN_REQUEST_URL: 'https://example.invalid/oidc',
		ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'oidc-request-token',
	};
}

function provenanceAudit(commit, mutate = () => {}) {
	const statement = {
		_type: 'https://in-toto.io/Statement/v1',
		predicateType: 'https://slsa.dev/provenance/v1',
		predicate: {
			buildDefinition: {
				buildType: 'https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1',
				externalParameters: { workflow: { repository: 'https://github.com/yaona807/virune', path: '.github/workflows/release.yml', ref: 'refs/heads/release-candidate/v1.1.0-rc.1' } },
				resolvedDependencies: [{ uri: 'git+https://github.com/yaona807/virune@refs/heads/release-candidate/v1.1.0-rc.1', digest: { gitCommit: commit } }],
			},
			runDetails: { builder: { id: 'https://github.com/actions/runner/github-hosted' } },
		},
	};
	mutate(statement);
	return {
		invalid: [],
		missing: [],
		verified: [{
			name: '@virune/runtime',
			version: VERSION,
			attestationBundles: [{
				predicateType: 'https://slsa.dev/provenance/v1',
				bundle: { dsseEnvelope: { payload: Buffer.from(JSON.stringify(statement)).toString('base64') } },
			}],
		}],
	};
}

function response(status, json) {
	return {
		status,
		ok: status >= 200 && status < 300,
		async json() { return json; },
	};
}
