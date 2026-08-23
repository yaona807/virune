import assert from 'node:assert/strict';
import test from 'node:test';
import {
	NPM_PUBLICATION_ORDER,
	assertNoTraditionalNpmCredentials,
	executePublication,
	npmPublishArguments,
	observeRegistryCandidate,
	orderedPublicationCandidates,
	validateObservedDependencyClosure,
	validateTrustedPublishingProvenance,
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
			for (const dependency of dependenciesFor(candidate.registryName)) assert.equal(state.get(dependency), 'exact');
			publishes.push(candidate.registryName);
			state.set(candidate.registryName, 'exact');
		},
	});
	assert.deepEqual(publishes, ['@virune/compiler', '@virune/formatter', '@virune/js-interop', 'virune']);
	assert.deepEqual(result.skipped, ['@virune/runtime', '@virune/stdlib']);
	assert.deepEqual(result.published, publishes);
	assert.deepEqual(provenance.slice(0, 2), ['@virune/runtime', '@virune/stdlib']);
	assert.deepEqual(provenance.slice(2), publishes);
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
	]) assert.throws(() => assertNoTraditionalNpmCredentials(env), /traditional npm publication credentials are forbidden/u);
	assert.equal(verifyTrustedPublishingToolchain({ nodeVersion: '24.7.0', npmVersion: '11.12.0' }), true);
	assert.throws(() => verifyTrustedPublishingToolchain({ nodeVersion: '22.13.9', npmVersion: '11.12.0' }), /requires >=22.14.0/u);
	assert.throws(() => verifyTrustedPublishingToolchain({ nodeVersion: '24.7.0', npmVersion: '11.11.9' }), /requires >=11.12.0/u);
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

function dependenciesFor(name) {
	return {
		'@virune/runtime': [],
		'@virune/compiler': ['@virune/runtime'],
		'@virune/formatter': ['@virune/compiler'],
		'@virune/js-interop': ['@virune/compiler'],
		'@virune/stdlib': ['@virune/runtime'],
		virune: ['@virune/runtime', '@virune/compiler', '@virune/formatter', '@virune/js-interop', '@virune/stdlib'],
	}[name];
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
