import { access, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const RULE_ID_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+$/u;
const RULE_HEADING_PATTERN = /^(?:#{2,6}\s+)?`\[([^\]\r\n]+)\]`(?:\s|$)/gmu;
const ANNOTATION_PREFIX = '// @virune-rule ';
const GRAMMAR_RULE_ID = 'grammar.complete';

export async function verifySpec(root = resolve('.'), { writeReport = true } = {}) {
	root = resolve(root);
	const specDirectory = join(root, 'spec');
	const indexText = await readFile(join(specDirectory, 'README.md'), 'utf8');
	if (!await exists(join(specDirectory, 'README_ja.md'))) throw new Error('spec/README_ja.md is missing');
	const languageVersion = readLanguageVersion(indexText);
	const pairs = await discoverNormativeDocumentPairs(specDirectory);
	const ruleOrigins = new Map();
	const ruleOrder = [];

	for (const pair of pairs) {
		const englishText = await readFile(pair.englishPath, 'utf8');
		const japaneseText = await readFile(pair.japanesePath, 'utf8');
		const englishIds = extractRuleIds(englishText, pair.englishRelative);
		const japaneseIds = extractRuleIds(japaneseText, pair.japaneseRelative);
		if (!sameArray(englishIds, japaneseIds)) {
			throw new Error(`English/Japanese rule order differs for ${pair.englishRelative} and ${pair.japaneseRelative}:\nEN ${JSON.stringify(englishIds)}\nJA ${JSON.stringify(japaneseIds)}`);
		}
		for (const id of englishIds) addNormativeRule(id, pair.englishRelative, ruleOrigins, ruleOrder);
	}

	const grammarPath = join(specDirectory, 'grammar.ebnf');
	const hasGrammar = await exists(grammarPath);
	if (hasGrammar) addNormativeRule(GRAMMAR_RULE_ID, 'spec/grammar.ebnf', ruleOrigins, ruleOrder);
	if (ruleOrder.length === 0) throw new Error('No normative rule IDs were discovered');

	const runTestsPath = join(root, 'scripts', 'run-tests.mjs');
	const runUnitTestsPath = join(root, 'scripts', 'run-unit-tests.mjs');
	const runTestsText = await readFile(runTestsPath, 'utf8');
	const runUnitTestsText = await readFile(runUnitTestsPath, 'utf8');
	const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
	const packageScripts = Object.values(packageJson.scripts ?? {}).filter(value => typeof value === 'string').join('\n');
	const ruleIds = new Set(ruleOrder);
	const evidenceByRule = new Map(ruleOrder.map(id => [id, []]));
	const unknownEvidenceReferences = [];

	const conformanceFiles = await collectFiles(join(root, 'conformance'), path => path.endsWith('.expected.json'));
	if (conformanceFiles.length > 0 && !runTestsText.includes('integration/dist/conformance.test.js')) {
		throw new Error('Conformance expectations exist but the repository-owned core runner does not execute integration/dist/conformance.test.js');
	}
	for (const expectedPath of conformanceFiles.sort()) {
		const expectedRelative = repositoryRelative(root, expectedPath);
		let expectation;
		try {
			expectation = JSON.parse(await readFile(expectedPath, 'utf8'));
		} catch (error) {
			throw new Error(`Malformed conformance expectation ${expectedRelative}: ${error instanceof Error ? error.message : String(error)}`);
		}
		if (expectation.rules === undefined) continue;
		if (!Array.isArray(expectation.rules) || expectation.rules.length === 0) throw new Error(`${expectedRelative} has an empty or malformed rules array`);
		if (new Set(expectation.rules).size !== expectation.rules.length) throw new Error(`${expectedRelative} has duplicate rule IDs`);
		const kind = expectation.status === 'compile-error' ? 'negative'
			: expectation.status === 'compile-success' ? 'positive'
				: null;
		if (kind === null) throw new Error(`${expectedRelative} has invalid status ${String(expectation.status)}`);
		const sourcePath = expectedPath.slice(0, -'.expected.json'.length);
		const sourceRelative = repositoryRelative(root, sourcePath);
		if (!sourceRelative.endsWith('.virune') || !await exists(sourcePath)) throw new Error(`Stale conformance evidence source for ${expectedRelative}: ${sourceRelative}`);
		for (const id of expectation.rules) {
			validateRuleId(id, `${expectedRelative} rules`);
			if (!ruleIds.has(id)) {
				unknownEvidenceReferences.push(`${expectedRelative}: ${id}`);
				continue;
			}
			evidenceByRule.get(id).push({
				file: sourceRelative,
				case: null,
				kind,
				platform: normalizePlatform(expectation.platform),
				source: 'conformance',
			});
		}
	}

	const annotationFiles = await collectAnnotationFiles(root);
	for (const declarationPath of annotationFiles) {
		const declarationRelative = repositoryRelative(root, declarationPath);
		const text = await readFile(declarationPath, 'utf8');
		for (const annotation of parseRuleAnnotations(text, declarationRelative)) {
			validateRuleId(annotation.id, `${declarationRelative}:${annotation.line}`);
			if (!ruleIds.has(annotation.id)) {
				unknownEvidenceReferences.push(`${declarationRelative}:${annotation.line}: ${annotation.id}`);
				continue;
			}
			if (annotation.kind === 'verifier') {
				if (!declarationRelative.endsWith('.mjs') || !packageScripts.includes(declarationRelative)) {
					throw new Error(`Stale verifier evidence ${declarationRelative}:${annotation.line}: ${declarationRelative} is not executed by a repository-owned package script`);
				}
				evidenceByRule.get(annotation.id).push({
					file: declarationRelative,
					case: null,
					kind: 'positive',
					platform: 'common',
					source: 'verifier',
				});
				continue;
			}
			await verifyTestEvidence(root, annotation, declarationRelative, runTestsText, runUnitTestsText);
			evidenceByRule.get(annotation.id).push({
				file: annotation.file,
				case: annotation.case,
				kind: annotation.kind,
				platform: annotation.platform,
				source: 'test',
			});
		}
	}

	const report = buildCoverageReport({
		languageVersion,
		normativeDocumentCount: pairs.length + (hasGrammar ? 1 : 0),
		ruleOrder,
		ruleOrigins,
		evidenceByRule,
		unknownEvidenceReferences,
	});
	if (writeReport) {
		const outputPath = join(root, '.virune-cache', 'spec-rule-coverage.json');
		await mkdir(dirname(outputPath), { recursive: true });
		await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
	}

	const failures = [];
	if (report.unknownEvidenceReferences.length > 0) {
		failures.push(`Evidence references unknown normative rules:\n${report.unknownEvidenceReferences.join('\n')}`);
	}
	if (report.unmappedRules.length > 0) {
		failures.push(`Normative rules without executable evidence:\n${report.unmappedRules.join('\n')}`);
	}
	if (failures.length > 0) throw new Error(failures.join('\n'));

	console.log(`Verified executable evidence for ${report.rulesWithExecutableEvidence}/${report.normativeRuleCount} normative rules.`);
	console.log(`Evidence sources: ${report.evidenceSourceCount}; positive mappings: ${report.positiveMappings}; negative mappings: ${report.negativeMappings}.`);
	return report;
}

export function extractRuleIds(text, source = '<spec>') {
	const ids = [];
	const seen = new Set();
	for (const match of text.matchAll(RULE_HEADING_PATTERN)) {
		const id = match[1];
		validateRuleId(id, source);
		if (seen.has(id)) throw new Error(`Duplicate normative rule id ${id} in ${source}`);
		seen.add(id);
		ids.push(id);
	}
	return ids;
}

export function parseRuleAnnotations(text, source = '<source>') {
	const annotations = [];
	for (const [index, lineText] of text.split(/\r?\n/u).entries()) {
		const trimmed = lineText.trim();
		if (!trimmed.startsWith(ANNOTATION_PREFIX)) continue;
		const payload = trimmed.slice(ANNOTATION_PREFIX.length).trim();
		if (payload.length === 0) throw new Error(`Malformed @virune-rule annotation in ${source}:${index + 1}`);
		if (!payload.startsWith('{')) {
			if (!RULE_ID_PATTERN.test(payload)) throw new Error(`Malformed @virune-rule annotation in ${source}:${index + 1}`);
			annotations.push({ id: payload, kind: 'verifier', line: index + 1 });
			continue;
		}
		let value;
		try {
			value = JSON.parse(payload);
		} catch (error) {
			throw new Error(`Malformed @virune-rule JSON in ${source}:${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
		}
		if (value === null || Array.isArray(value) || typeof value !== 'object') throw new Error(`Malformed @virune-rule object in ${source}:${index + 1}`);
		const allowedKeys = new Set(['id', 'runner', 'file', 'case', 'kind', 'platform']);
		for (const key of Object.keys(value)) if (!allowedKeys.has(key)) throw new Error(`Unknown @virune-rule field ${key} in ${source}:${index + 1}`);
		if (typeof value.id !== 'string' || typeof value.runner !== 'string' || typeof value.file !== 'string' || typeof value.case !== 'string') {
			throw new Error(`Partial @virune-rule annotation in ${source}:${index + 1}`);
		}
		if (value.runner !== 'unit' && value.runner !== 'integration') throw new Error(`Invalid @virune-rule runner ${value.runner} in ${source}:${index + 1}`);
		const kind = value.kind ?? 'positive';
		if (kind !== 'positive' && kind !== 'negative') throw new Error(`Invalid @virune-rule kind ${String(kind)} in ${source}:${index + 1}`);
		const platform = normalizePlatform(value.platform);
		if (!isCanonicalRepositoryPath(value.file)) throw new Error(`Non-canonical @virune-rule file ${value.file} in ${source}:${index + 1}`);
		if (value.case.length === 0) throw new Error(`Empty @virune-rule case in ${source}:${index + 1}`);
		annotations.push({
			id: value.id,
			runner: value.runner,
			file: value.file,
			case: value.case,
			kind,
			platform,
			line: index + 1,
		});
	}
	return annotations;
}

export function buildCoverageReport({ languageVersion, normativeDocumentCount, ruleOrder, ruleOrigins, evidenceByRule, unknownEvidenceReferences = [] }) {
	const rules = [...ruleOrder].sort().map(id => {
		const evidence = [...(evidenceByRule.get(id) ?? [])].sort(compareEvidence);
		return {
			id,
			source: ruleOrigins.get(id) ?? null,
			evidenceCount: evidence.length,
			positive: evidence.filter(item => item.kind === 'positive').length,
			negative: evidence.filter(item => item.kind === 'negative').length,
			platforms: [...new Set(evidence.map(item => item.platform))].sort(),
			evidence,
		};
	});
	const rulesWithExecutableEvidence = rules.filter(rule => rule.evidenceCount > 0).length;
	const normativeRuleCount = rules.length;
	const allEvidence = rules.flatMap(rule => rule.evidence);
	return {
		schemaVersion: 2,
		languageVersion,
		normativeDocumentCount,
		normativeRuleCount,
		rulesWithExecutableEvidence,
		unmappedRules: rules.filter(rule => rule.evidenceCount === 0).map(rule => rule.id),
		unknownEvidenceReferences: [...unknownEvidenceReferences].sort(),
		evidenceSourceCount: new Set(allEvidence.map(item => item.file)).size,
		positiveMappings: allEvidence.filter(item => item.kind === 'positive').length,
		negativeMappings: allEvidence.filter(item => item.kind === 'negative').length,
		executableEvidenceCoveragePercent: normativeRuleCount === 0 ? 0 : Number(((rulesWithExecutableEvidence / normativeRuleCount) * 100).toFixed(2)),
		rules,
	};
}

async function discoverNormativeDocumentPairs(specDirectory) {
	const entries = await readdir(specDirectory, { withFileTypes: true });
	const markdown = entries.filter(entry => entry.isFile() && entry.name.endsWith('.md')).map(entry => entry.name).sort();
	const english = markdown.filter(name => name !== 'README.md' && !name.endsWith('_ja.md'));
	const japanese = markdown.filter(name => name !== 'README_ja.md' && name.endsWith('_ja.md'));
	const pairs = [];
	for (const name of english) {
		const japaneseName = `${name.slice(0, -3)}_ja.md`;
		if (!markdown.includes(japaneseName)) throw new Error(`Missing Japanese normative counterpart for spec/${name}`);
		pairs.push({
			englishPath: join(specDirectory, name),
			japanesePath: join(specDirectory, japaneseName),
			englishRelative: `spec/${name}`,
			japaneseRelative: `spec/${japaneseName}`,
		});
	}
	for (const name of japanese) {
		const englishName = `${name.slice(0, -'_ja.md'.length)}.md`;
		if (!markdown.includes(englishName)) throw new Error(`Missing English normative counterpart for spec/${name}`);
	}
	return pairs;
}

function readLanguageVersion(indexText) {
	const match = indexText.match(/^# Virune (\d+\.\d+) Normative Specification\s*$/mu);
	if (match === null) throw new Error('spec/README.md does not declare a canonical Virune language version');
	return match[1];
}

function addNormativeRule(id, source, ruleOrigins, ruleOrder) {
	validateRuleId(id, source);
	if (ruleOrigins.has(id)) throw new Error(`Duplicate normative rule id ${id} in ${source}; first declared by ${ruleOrigins.get(id)}`);
	ruleOrigins.set(id, source);
	ruleOrder.push(id);
}

function validateRuleId(id, source) {
	if (typeof id !== 'string' || !RULE_ID_PATTERN.test(id)) throw new Error(`Invalid rule id ${String(id)} in ${source}`);
}

async function collectAnnotationFiles(root) {
	const output = [];
	output.push(...await collectFiles(join(root, 'scripts'), path => path.endsWith('.mjs')));
	output.push(...await collectFiles(join(root, 'integration'), path => path.endsWith('.ts')));
	for (const entry of await readDirOrEmpty(join(root, 'packages'))) {
		if (!entry.isDirectory()) continue;
		output.push(...await collectFiles(join(root, 'packages', entry.name, 'test'), path => path.endsWith('.ts')));
	}
	return [...new Set(output)].sort();
}

async function verifyTestEvidence(root, annotation, declarationRelative, runTestsText, runUnitTestsText) {
	if (declarationRelative !== 'scripts/run-tests.mjs' && declarationRelative !== annotation.file) {
		throw new Error(`@virune-rule test evidence must be declared in its test source or scripts/run-tests.mjs: ${declarationRelative}:${annotation.line}`);
	}
	const targetPath = join(root, ...annotation.file.split('/'));
	if (!await exists(targetPath)) throw new Error(`Stale evidence target ${annotation.file} for ${annotation.id}`);
	const targetText = await readFile(targetPath, 'utf8');
	if (!containsTestCase(targetText, annotation.case)) throw new Error(`Stale evidence case ${JSON.stringify(annotation.case)} in ${annotation.file} for ${annotation.id}`);

	if (annotation.runner === 'integration') {
		if (!/^integration\/.+\.test\.ts$/u.test(annotation.file)) throw new Error(`Integration evidence is outside integration tests: ${annotation.file}`);
		const compiled = `integration/dist/${annotation.file.slice('integration/'.length).replace(/\.ts$/u, '.js')}`;
		if (!runTestsText.includes(compiled)) throw new Error(`Stale integration evidence ${annotation.file}: ${compiled} is not executed by scripts/run-tests.mjs`);
		return;
	}

	const match = annotation.file.match(/^packages\/([^/]+)\/test\/.+\.test\.ts$/u);
	if (match === null) throw new Error(`Unit evidence is outside package test discovery: ${annotation.file}`);
	if (!runTestsText.includes('scripts/run-unit-tests.mjs')) throw new Error('scripts/run-tests.mjs no longer invokes the unit-test discovery runner');
	if (!runUnitTestsText.includes("collectTests(join('packages', entry.name, 'dist', 'test'), files)") || !runUnitTestsText.includes("entry.name.endsWith('.test.js')")) {
		throw new Error('scripts/run-unit-tests.mjs no longer provides the reviewed package dist/test *.test.js discovery path');
	}
	if (!await exists(join(root, 'packages', match[1], 'tsconfig.json'))) throw new Error(`Stale unit evidence workspace for ${annotation.file}`);
}

function containsTestCase(text, caseName) {
	const single = `'${caseName.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
	const double = JSON.stringify(caseName);
	return text.includes(`test(${single}`) || text.includes(`test(${double}`);
}

function normalizePlatform(value) {
	if (value === undefined || value === null) return 'common';
	if (typeof value !== 'string' || value.length === 0) throw new Error(`Invalid evidence platform ${String(value)}`);
	return value;
}

function isCanonicalRepositoryPath(value) {
	if (typeof value !== 'string' || value.length === 0 || value.startsWith('/') || value.includes('\\')) return false;
	const segments = value.split('/');
	return segments.every(segment => segment.length > 0 && segment !== '.' && segment !== '..');
}

function repositoryRelative(root, path) {
	return relative(root, path).replaceAll('\\', '/');
}

function sameArray(left, right) {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function compareEvidence(left, right) {
	const leftKey = `${left.file}\u0000${left.case ?? ''}\u0000${left.kind}\u0000${left.platform}\u0000${left.source}`;
	const rightKey = `${right.file}\u0000${right.case ?? ''}\u0000${right.kind}\u0000${right.platform}\u0000${right.source}`;
	return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

async function exists(path) {
	try {
		await access(path);
		return true;
	} catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
		throw error;
	}
}

async function readDirOrEmpty(path) {
	try {
		return await readdir(path, { withFileTypes: true });
	} catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
		throw error;
	}
}

async function collectFiles(path, predicate) {
	let info;
	try {
		info = await stat(path);
	} catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
		throw error;
	}
	if (info.isFile()) return predicate(path) ? [path] : [];
	const output = [];
	for (const entry of await readdir(path, { withFileTypes: true })) {
		const child = join(path, entry.name);
		if (entry.isDirectory()) output.push(...await collectFiles(child, predicate));
		else if (entry.isFile() && predicate(child)) output.push(child);
	}
	return output;
}

const invokedPath = process.argv[1] === undefined ? null : pathToFileURL(resolve(process.argv[1])).href;
if (invokedPath !== null && import.meta.url === invokedPath) await verifySpec(resolve('.'));
