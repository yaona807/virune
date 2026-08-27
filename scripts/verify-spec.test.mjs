import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { buildCoverageReport, verifySpec } from './verify-spec.mjs';

test('spec evidence graph accepts a repository-run integration test', async t => {
	const root = await createFixture(t, {
		annotations: [testEvidence('type.one', 'integration/example.test.ts', 'works')],
		runnerEntries: ['integration/dist/example.test.js'],
		testFiles: { 'integration/example.test.ts': "test('works', () => {});\n" },
	});
	const report = await verifySpec(root, { writeReport: false });
	assert.equal(report.normativeRuleCount, 1);
	assert.equal(report.rulesWithExecutableEvidence, 1);
	assert.equal(report.positiveMappings, 1);
	assert.equal(report.negativeMappings, 0);
	assert.equal(report.executableEvidenceCoveragePercent, 100);
});

test('inline normative rule declarations are discovered', async t => {
	const inline = '# Entry\n\n`[type.one]` The rule is declared inline.\n';
	const root = await createFixture(t, {
		english: inline,
		japanese: '# エントリー\n\n`[type.one]` 規則を行頭で宣言する。\n',
		annotations: [testEvidence('type.one', 'integration/example.test.ts', 'works')],
		runnerEntries: ['integration/dist/example.test.js'],
		testFiles: { 'integration/example.test.ts': "test('works', () => {});\n" },
	});
	const report = await verifySpec(root, { writeReport: false });
	assert.equal(report.normativeRuleCount, 1);
	assert.deepEqual(report.unmappedRules, []);
});

test('compile-error conformance expectation is executable negative evidence', async t => {
	const root = await createFixture(t, {
		runnerEntries: ['integration/dist/conformance.test.js'],
		conformance: {
			'conformance/case.virune': 'fn main() -> Unit {}\n',
			'conformance/case.virune.expected.json': `${JSON.stringify({ status: 'compile-error', rules: ['type.one'] }, null, 2)}\n`,
		},
	});
	const report = await verifySpec(root, { writeReport: false });
	assert.equal(report.positiveMappings, 0);
	assert.equal(report.negativeMappings, 1);
	assert.deepEqual(report.unmappedRules, []);
});

test('missing executable evidence fails closed', async t => {
	const root = await createFixture(t);
	await assert.rejects(() => verifySpec(root, { writeReport: false }), /Normative rules without executable evidence:[\s\S]*type\.one/u);
});

test('unknown evidence reference fails closed', async t => {
	const root = await createFixture(t, {
		annotations: [testEvidence('type.unknown', 'integration/example.test.ts', 'works')],
		runnerEntries: ['integration/dist/example.test.js'],
		testFiles: { 'integration/example.test.ts': "test('works', () => {});\n" },
	});
	await assert.rejects(() => verifySpec(root, { writeReport: false }), /Evidence references unknown normative rules:[\s\S]*type\.unknown/u);
});

test('duplicate normative rule ID fails closed', async t => {
	const duplicated = '# Types\n\n## `[type.one]` One\nA.\n\n## `[type.one]` Again\nB.\n';
	const root = await createFixture(t, { english: duplicated, japanese: duplicated });
	await assert.rejects(() => verifySpec(root, { writeReport: false }), /Duplicate normative rule id type\.one/u);
});

test('malformed normative rule ID fails closed', async t => {
	const malformed = '# Types\n\n## `[Type.one]` Invalid\nA.\n';
	const root = await createFixture(t, { english: malformed, japanese: malformed });
	await assert.rejects(() => verifySpec(root, { writeReport: false }), /Invalid rule id Type\.one/u);
});

test('partial evidence annotation fails closed', async t => {
	const root = await createFixture(t, {
		annotations: [{ id: 'type.one', runner: 'integration', file: 'integration/example.test.ts' }],
		runnerEntries: ['integration/dist/example.test.js'],
		testFiles: { 'integration/example.test.ts': "test('works', () => {});\n" },
	});
	await assert.rejects(() => verifySpec(root, { writeReport: false }), /Partial @virune-rule annotation/u);
});

test('stale evidence file fails closed', async t => {
	const root = await createFixture(t, {
		annotations: [testEvidence('type.one', 'integration/missing.test.ts', 'works')],
		runnerEntries: ['integration/dist/missing.test.js'],
	});
	await assert.rejects(() => verifySpec(root, { writeReport: false }), /Stale evidence target integration\/missing\.test\.ts/u);
});

test('stale evidence case fails closed', async t => {
	const root = await createFixture(t, {
		annotations: [testEvidence('type.one', 'integration/example.test.ts', 'missing case')],
		runnerEntries: ['integration/dist/example.test.js'],
		testFiles: { 'integration/example.test.ts': "test('actual case', () => {});\n" },
	});
	await assert.rejects(() => verifySpec(root, { writeReport: false }), /Stale evidence case "missing case"/u);
});

test('English/Japanese rule order mismatch fails closed', async t => {
	const root = await createFixture(t, {
		japanese: '# 型\n\n## `[type.two]` 二\nA.\n',
	});
	await assert.rejects(() => verifySpec(root, { writeReport: false }), /English\/Japanese rule order differs/u);
});

test('coverage percentage is derived from actual evidence counts', () => {
	const report = buildCoverageReport({
		languageVersion: '1.0',
		normativeDocumentCount: 1,
		ruleOrder: ['type.one', 'type.two'],
		ruleOrigins: new Map([['type.one', 'spec/types.md'], ['type.two', 'spec/types.md']]),
		evidenceByRule: new Map([
			['type.one', [{ file: 'integration/example.test.ts', case: 'works', kind: 'positive', platform: 'common', source: 'test' }]],
			['type.two', []],
		]),
	});
	assert.equal(report.normativeRuleCount, 2);
	assert.equal(report.rulesWithExecutableEvidence, 1);
	assert.equal(report.executableEvidenceCoveragePercent, 50);
	assert.deepEqual(report.unmappedRules, ['type.two']);
});

function testEvidence(id, file, caseName) {
	return { id, runner: 'integration', file, case: caseName, kind: 'positive', platform: 'common' };
}

function annotationLine(value) {
	return `// ${'@virune-rule'} ${JSON.stringify(value)}`;
}

async function createFixture(t, options = {}) {
	const root = await mkdtemp(join(tmpdir(), 'virune-spec-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const english = options.english ?? '# Types\n\n## `[type.one]` One\nA.\n';
	const japanese = options.japanese ?? '# 型\n\n## `[type.one]` 一\nA.\n';
	await write(root, 'spec/README.md', '# Virune 1.0 Normative Specification\n');
	await write(root, 'spec/README_ja.md', '# Virune 1.0 規範仕様\n');
	await write(root, 'spec/types.md', english);
	await write(root, 'spec/types_ja.md', japanese);
	const annotationText = (options.annotations ?? []).map(annotationLine).join('\n');
	const runnerEntries = (options.runnerEntries ?? []).map(value => `// executes ${value}`).join('\n');
	await write(root, 'scripts/run-tests.mjs', `${annotationText}${annotationText.length > 0 ? '\n' : ''}${runnerEntries}\n`);
	await write(root, 'scripts/run-unit-tests.mjs', "collectTests(join('packages', entry.name, 'dist', 'test'), files)\nentry.name.endsWith('.test.js')\n");
	await write(root, 'package.json', `${JSON.stringify({ scripts: {} }, null, 2)}\n`);
	for (const [path, content] of Object.entries(options.testFiles ?? {})) await write(root, path, content);
	for (const [path, content] of Object.entries(options.conformance ?? {})) await write(root, path, content);
	return root;
}

async function write(root, path, content) {
	const destination = join(root, ...path.split('/'));
	await mkdir(dirname(destination), { recursive: true });
	await writeFile(destination, content, 'utf8');
}
