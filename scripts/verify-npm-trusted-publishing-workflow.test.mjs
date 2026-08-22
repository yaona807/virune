import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import {
	validateNpmTrustedPublishingPolicy,
	validateNpmTrustedPublishingWorkflowSource,
	versionAtLeast,
} from './verify-npm-trusted-publishing-workflow.mjs';

const policy = JSON.parse(readFileSync(resolve('.github/release/npm-trusted-publishing-v1.json'), 'utf8'));
const releaseWorkflow = readFileSync(resolve('.github/workflows/release.yml'), 'utf8');

test('current release workflow satisfies the repository contract without claiming publication authority', () => {
	const report = validateNpmTrustedPublishingWorkflowSource(releaseWorkflow, policy);
	assert.deepEqual(report, {
		schemaVersion: 1,
		kind: 'npm-trusted-publishing-workflow-contract-v1',
		status: 'repository-contract-only',
		repository: 'yaona807/virune',
		workflowFile: 'release.yml',
		provider: 'github-actions',
		runner: 'ubuntu-24.04',
		nodeVersion: '24',
		explicitNpmVersion: null,
		idTokenPermission: 'write',
		publishAction: null,
		workflowPublicationBoundaryPresent: false,
		longLivedPublishCredentialWiringPresent: false,
		npmSideObservationRequired: true,
		publicationReady: false,
	});
});

test('policy identity, allowed action, and external minimums are exact and fail closed on unknown fields', () => {
	assert.deepEqual(validateNpmTrustedPublishingPolicy(policy), policy);
	const mutations = [
		value => { value.schemaVersion = 2; },
		value => { value.status = 'ready'; },
		value => { value.provider = 'other'; },
		value => { value.repository = 'fork/virune'; },
		value => { value.workflowFile = 'publish.yml'; },
		value => { value.runner = 'self-hosted'; },
		value => { value.registry = 'https://registry.example.invalid/'; },
		value => { value.minimumNodeVersion = '22'; },
		value => { value.minimumNpmVersion = 'latest'; },
		value => { value.allowedPublishAction = 'stage-publish'; },
		value => { value.requiredPermission = { 'id-token': 'read' }; },
		value => { value.forbiddenPublishCredentialEnv = ['NPM_TOKEN', 'NODE_AUTH_TOKEN']; },
		value => { value.npmSideObservationRequired = false; },
		value => { value.unexpected = true; },
	];
	for (const mutate of mutations) {
		const value = structuredClone(policy);
		mutate(value);
		assert.throws(() => validateNpmTrustedPublishingPolicy(value));
	}
});

test('repository-contract-only workflow rejects permission, runner, Node, credential, provenance, and publish drift', () => {
	const mutations = [
		source => source.replace('  id-token: write\n', '  id-token: read\n'),
		source => source.replace('    runs-on: ubuntu-24.04\n', '    runs-on: self-hosted\n'),
		source => source.replace('          node-version: 24\n', '          node-version: 20\n'),
		source => source.replace('        env:\n          GITHUB_TOKEN:', '        env:\n          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}\n          GITHUB_TOKEN:'),
		source => source.replace('      - name: Upload release evidence\n', '      - name: Publish unexpectedly\n        run: npm publish\n      - name: Upload release evidence\n'),
		source => source.replace('      - name: Upload release evidence\n', '      - name: Disable npm provenance\n        run: npm config set provenance false --location=user\n        env:\n          NPM_CONFIG_PROVENANCE: false\n      - name: Upload release evidence\n'),
	];
	for (const mutate of mutations) {
		assert.throws(() => validateNpmTrustedPublishingWorkflowSource(mutate(releaseWorkflow), policy));
	}
});

test('optional explicit npm pin is accepted only at or above the reviewed minimum before publication activation', () => {
	const source = withNpmPin(releaseWorkflow, '11.5.1');
	const report = validateNpmTrustedPublishingWorkflowSource(source, policy);
	assert.equal(report.explicitNpmVersion, '11.5.1');
	assert.equal(report.publicationReady, false);
	assert.throws(() => validateNpmTrustedPublishingWorkflowSource(withNpmPin(releaseWorkflow, '11.5.0'), policy), /expected npm 11\.5\.1 or newer/u);
});

test('future publication workflow requires exact OIDC boundary, supported npm, allowed action, and still does not self-authorize', () => {
	const activePolicy = { ...policy, status: 'publication-workflow' };
	const source = withPublish(withNpmPin(releaseWorkflow, '11.5.1'), 'npm publish --access public --tag next');
	const report = validateNpmTrustedPublishingWorkflowSource(source, activePolicy);
	assert.equal(report.status, 'publication-workflow');
	assert.equal(report.explicitNpmVersion, '11.5.1');
	assert.equal(report.publishAction, 'publish');
	assert.equal(report.workflowPublicationBoundaryPresent, true);
	assert.equal(report.npmSideObservationRequired, true);
	assert.equal(report.publicationReady, false);

	assert.throws(() => validateNpmTrustedPublishingWorkflowSource(withPublish(releaseWorkflow, 'npm publish'), activePolicy), /must pin one exact npm CLI version/u);
	assert.throws(() => validateNpmTrustedPublishingWorkflowSource(withPublish(withNpmPin(releaseWorkflow, '11.5.1'), 'npm stage publish'), activePolicy), /expected allowed action publish/u);
	assert.throws(() => validateNpmTrustedPublishingWorkflowSource(withPublish(withNpmPin(releaseWorkflow, '11.5.1'), 'command npm publish'), activePolicy), /direct canonical npm command/u);
	assert.throws(() => validateNpmTrustedPublishingWorkflowSource(withPublish(withNpmPin(releaseWorkflow, '11.5.1'), 'npm --registry=https://registry.npmjs.org/ publish'), activePolicy), /direct canonical npm command/u);
});

test('semantic version minimum comparison is deterministic at boundaries', () => {
	assert.equal(versionAtLeast('22.14.0', '22.14.0'), true);
	assert.equal(versionAtLeast('22.14.1', '22.14.0'), true);
	assert.equal(versionAtLeast('24.0.0', '22.14.0'), true);
	assert.equal(versionAtLeast('22.13.99', '22.14.0'), false);
	assert.equal(versionAtLeast('11.5.0', '11.5.1'), false);
	assert.throws(() => versionAtLeast('11.5', '11.5.1'));
});

function withNpmPin(source, version) {
	return source.replace(
		'      - name: Install dependencies\n',
		`      - name: Install supported npm\n        run: npm install --global npm@${version}\n      - name: Install dependencies\n`,
	);
}

function withPublish(source, command) {
	return source.replace(
		'      - name: Upload release evidence\n',
		`      - name: npm Trusted Publishing boundary\n        run: ${command}\n      - name: Upload release evidence\n`,
	);
}
