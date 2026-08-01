import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	KernelContractError,
	roundTripKernelInput,
	validateKernelInput,
	type KernelInputV1,
} from '../src/selfhost/contract.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const corpusRoot = join(repositoryRoot, 'packages', 'compiler', 'test', 'fixtures', 'selfhost-interop-manifest-v1');

type AcceptedCase = {
	readonly id: string;
	readonly accepted: true;
	readonly input: unknown;
	readonly entryPath: string;
	readonly sourcePaths: readonly string[];
	readonly moduleSpecifiers: readonly string[];
	readonly metadataKeys: readonly (readonly string[])[];
};
type RejectedCase = {
	readonly id: string;
	readonly accepted: false;
	readonly input: unknown;
	readonly errorPath: string;
	readonly errorIncludes: string;
};
type CorpusCase = AcceptedCase | RejectedCase;
type CorpusManifest = { readonly version: number; readonly cases: readonly CorpusCase[] };

test('versioned Interop Manifest corpus is canonical, deterministic, and fail-closed', async t => {
	const manifest = JSON.parse(await readFile(join(corpusRoot, 'corpus.json'), 'utf8')) as CorpusManifest;
	assert.equal(manifest.version, 1);
	assert.deepEqual(manifest.cases.map(item => item.id), [...manifest.cases.map(item => item.id)].sort());
	assert.equal(new Set(manifest.cases.map(item => item.id)).size, manifest.cases.length);

	for (const fixture of manifest.cases) {
		await t.test(fixture.id, () => {
			if (fixture.accepted) validateAccepted(fixture);
			else validateRejected(fixture);
		});
	}
});

function validateAccepted(fixture: AcceptedCase): void {
	const first = validateKernelInput(fixture.input);
	const second = validateKernelInput(fixture.input);
	assert.equal(JSON.stringify(first), JSON.stringify(second), `${fixture.id}: canonical serialization`);
	assert.equal(first.entryPath, fixture.entryPath);
	assert.deepEqual(first.sources.map(item => item.path), fixture.sourcePaths);
	assert.deepEqual(first.interopManifest.modules.map(item => item.specifier), fixture.moduleSpecifiers);
	assert.deepEqual(
		first.interopManifest.modules.map(item => Object.keys(item.metadata)),
		fixture.metadataKeys,
	);
	assert.deepEqual(roundTripKernelInput(first), first);
	validateJsonOnly(first, fixture.id);
}

function validateRejected(fixture: RejectedCase): void {
	const first = captureError(fixture.input);
	const second = captureError(fixture.input);
	assert.equal(first.path, fixture.errorPath);
	assert.match(first.message, new RegExp(escapeRegExp(fixture.errorIncludes), 'u'));
	assert.deepEqual(
		{ name: first.name, path: first.path, message: first.message },
		{ name: second.name, path: second.path, message: second.message },
		`${fixture.id}: error changed between identical runs`,
	);
}

function captureError(input: unknown): KernelContractError {
	try {
		validateKernelInput(input);
	} catch (error) {
		assert.ok(error instanceof KernelContractError);
		return error;
	}
	assert.fail('expected KernelContractError');
}

function validateJsonOnly(input: KernelInputV1, fixtureId: string): void {
	const encoded = JSON.stringify(input);
	const decoded = JSON.parse(encoded) as unknown;
	assert.deepEqual(validateKernelInput(decoded), input, `${fixtureId}: JSON round trip`);
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
