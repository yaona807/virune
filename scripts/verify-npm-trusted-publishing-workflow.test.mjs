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

test('current release workflow satisfies the repository-side contract without claiming publication readiness', () => {
	const report = validateNpmTrustedPublishingWorkflowSource(releaseWorkflow, policy);
	assert.deepEqual(report, {
		schemaVersion: 1,
		kind: 'npm-trusted-publishing-workflow-contract-v1',
		repository: 'yaona807/virune',
		workflowFile: 'release.yml',
		provider: 'github-actions',
		runner: 'ubuntu-24.04',
		nodeVersion: '24',
		explicitNpmVersion: null,
		idTokenPermission: 'write',
		publishCommandPresent: false,
		longLivedPublishCredentialWiringPresent: false,
		npmSideObservationRequired: true,
		publicationReady: false,
	});
});

test('policy identity and external minimums are exact and fail closed on unknown fields', () => {
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

test('workflow contract rejects permission, runner, Node, credential, and publish-boundary drift', () => {
	const mutations = [
		source => source.replace('  id-token: write\n', '  id-token: read\n'),
		source => source.replace('    runs-on: ubuntu-24.04\n', '    runs-on: self-hosted\n'),
		source => source.replace('          node-version: 24\n', '          node-version: 20\n'),
		source => source.replace('        env:\n          GITHUB_TOKEN:', '        env:\n          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}\n          GITHUB_TOKEN:'),
		source => source.replace('      - name: Upload release evidence\n', '      - name: Publish unexpectedly\n        run: npm publish\n      - name: Upload release evidence\n'),
	];
	for (const mutate of mutations) {
		assert.throws(() => validateNpmTrustedPublishingWorkflowSource(mutate(releaseWorkflow), policy));
	}
});

test('optional explicit npm pin is accepted only at or above the reviewed minimum', () => {
	const insertion = '      - name: Install supported npm\n        run: npm install --global npm@11.5.1\n      - name: Install dependencies\n';
	const source = releaseWorkflow.replace('      - name: Install dependencies\n', insertion);
	const report = validateNpmTrustedPublishingWorkflowSource(source, policy);
	assert.equal(report.explicitNpmVersion, '11.5.1');
	const stale = source.replace('npm@11.5.1', 'npm@11.5.0');
	assert.throws(() => validateNpmTrustedPublishingWorkflowSource(stale, policy), /expected npm 11\.5\.1 or newer/u);
});

test('semantic version minimum comparison is deterministic at boundaries', () => {
	assert.equal(versionAtLeast('22.14.0', '22.14.0'), true);
	assert.equal(versionAtLeast('22.14.1', '22.14.0'), true);
	assert.equal(versionAtLeast('24.0.0', '22.14.0'), true);
	assert.equal(versionAtLeast('22.13.99', '22.14.0'), false);
	assert.equal(versionAtLeast('11.5.0', '11.5.1'), false);
	assert.throws(() => versionAtLeast('11.5', '11.5.1'));
});
