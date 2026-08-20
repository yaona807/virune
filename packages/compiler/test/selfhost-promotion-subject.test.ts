import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createPromotionSubjectManifest,
	promotionSubjectRequiredComponents,
	type PromotionSubjectComponentInputV2,
	type PromotionSubjectStage,
} from '../src/selfhost/promotion-subject.js';

const digest = (character: string): string => character.repeat(64);

function input(stage: PromotionSubjectStage, overrides: Readonly<Record<string, string>> = {}) {
	return {
		version: 2 as const,
		stage,
		components: promotionSubjectRequiredComponents(stage).map((id, index) => ({
			id,
			sha256: overrides[id] ?? digest((index % 10).toString()),
		})),
	};
}

test('promotion subject identity is deterministic and input-order independent', () => {
	const value = input('required-selfhost');
	const reversed = { ...value, components: [...value.components].reverse() };
	const first = createPromotionSubjectManifest(value);
	const second = createPromotionSubjectManifest(reversed);

	assert.equal(first.serialized, second.serialized);
	assert.equal(first.promotionSubjectId, second.promotionSubjectId);
	assert.deepEqual(first.manifest.components.map(component => component.id), promotionSubjectRequiredComponents('required-selfhost'));
});

test('changing any required component changes the promotion subject identity', () => {
	const baseline = createPromotionSubjectManifest(input('required-selfhost'));
	for (const id of promotionSubjectRequiredComponents('required-selfhost')) {
		const changed = createPromotionSubjectManifest(input('required-selfhost', { [id]: digest('f') }));
		assert.notEqual(changed.promotionSubjectId, baseline.promotionSubjectId, id);
	}
});

test('stage identity is domain-separated and broader stages include the narrower closure', () => {
	const selfhostIds = new Set(promotionSubjectRequiredComponents('required-selfhost'));
	const compilerIds = new Set(promotionSubjectRequiredComponents('required-compiler'));
	const productionIds = new Set(promotionSubjectRequiredComponents('production-default'));

	for (const id of selfhostIds) assert.equal(compilerIds.has(id), true, id);
	for (const id of compilerIds) assert.equal(productionIds.has(id), true, id);

	const shared = Object.fromEntries([...productionIds].map(id => [id, digest('a')]));
	const selfhost = createPromotionSubjectManifest(input('required-selfhost', shared));
	const compiler = createPromotionSubjectManifest(input('required-compiler', shared));
	const production = createPromotionSubjectManifest(input('production-default', shared));
	assert.notEqual(selfhost.promotionSubjectId, compiler.promotionSubjectId);
	assert.notEqual(compiler.promotionSubjectId, production.promotionSubjectId);
	assert.notEqual(selfhost.promotionSubjectId, production.promotionSubjectId);
});

test('manifest validation rejects missing, duplicate, extra, malformed, and non-canonical components', () => {
	const valid = input('required-selfhost');
	assert.throws(
		() => createPromotionSubjectManifest({ ...valid, components: valid.components.slice(1) }),
		/missing required components/u,
	);
	assert.throws(
		() => createPromotionSubjectManifest({ ...valid, components: [...valid.components, valid.components[0]] }),
		/duplicate component/u,
	);
	assert.throws(
		() => createPromotionSubjectManifest({
			...valid,
			components: [...valid.components, { id: 'documentation', sha256: digest('a') }],
		}),
		/not part of required-selfhost/u,
	);
	assert.throws(
		() => createPromotionSubjectManifest({
			...valid,
			components: valid.components.map((component, index): PromotionSubjectComponentInputV2 => index === 0
				? { ...component, sha256: 'A'.repeat(64) }
				: component),
		}),
		/lowercase 64-character SHA-256/u,
	);
	assert.throws(
		() => createPromotionSubjectManifest({
			...valid,
			components: valid.components.map((component, index) => index === 0
				? { ...component, source: 'main', sha256: component.sha256 }
				: component),
		}),
		/expected exactly keys id, sha256/u,
	);
});

test('manifest rejects repository execution identity and unknown stages', () => {
	const valid = input('required-selfhost');
	assert.throws(
		() => createPromotionSubjectManifest({ ...valid, executionCommit: '1'.repeat(40) }),
		/expected exactly keys components, stage, version/u,
	);
	assert.throws(
		() => createPromotionSubjectManifest({ ...valid, stage: 'nightly-shadow' }),
		/expected required-selfhost, required-compiler, or production-default/u,
	);
	assert.throws(
		() => createPromotionSubjectManifest({ ...valid, version: 1 }),
		/expected 2/u,
	);
});
