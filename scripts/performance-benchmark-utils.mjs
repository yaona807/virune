import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export function parseCliArguments(argumentsList) {
	const options = new Map();
	for (let index = 0; index < argumentsList.length; index++) {
		const argument = argumentsList[index];
		if (!argument.startsWith('--')) throw new Error(`Unexpected argument: ${argument}`);
		const separator = argument.indexOf('=');
		if (separator >= 0) {
			options.set(argument.slice(2, separator), argument.slice(separator + 1));
			continue;
		}
		const name = argument.slice(2);
		const value = argumentsList[index + 1];
		if (value === undefined || value.startsWith('--')) {
			options.set(name, 'true');
			continue;
		}
		options.set(name, value);
		index++;
	}
	return options;
}

export function requiredOption(options, name) {
	const value = options.get(name);
	if (value === undefined || value.length === 0) throw new Error(`Missing required option --${name}`);
	return value;
}

export function positiveIntegerOption(options, name, fallback) {
	const raw = options.get(name);
	if (raw === undefined) return fallback;
	const value = Number(raw);
	if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`--${name} must be a positive integer`);
	return value;
}

export function median(values) {
	if (values.length === 0) throw new Error('Cannot calculate the median of an empty list');
	const sorted = [...values].sort((left, right) => left - right);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0
		? (sorted[middle - 1] + sorted[middle]) / 2
		: sorted[middle];
}

export async function readJsonFile(path) {
	return JSON.parse(await readFile(path, 'utf8'));
}

export async function writeJsonFile(path, value) {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function evaluatePerformanceRegression(baseline, lspReport, interopReport) {
	if (baseline.schemaVersion !== 1) throw new Error(`Unsupported baseline schema version: ${baseline.schemaVersion}`);
	if (lspReport.schemaVersion !== 1) throw new Error(`Unsupported LSP report schema version: ${lspReport.schemaVersion}`);
	if (interopReport.schemaVersion !== 1) throw new Error(`Unsupported interop report schema version: ${interopReport.schemaVersion}`);

	const checks = [];
	const actualByModules = new Map(lspReport.report.map(entry => [entry.modules, entry]));
	const lspThresholds = baseline.lsp.thresholds;

	for (const expected of baseline.lsp.modules) {
		const actual = actualByModules.get(expected.modules);
		if (actual === undefined) throw new Error(`LSP report is missing ${expected.modules} modules`);
		checks.push(compareLatency({
			name: `LSP ${expected.modules} modules initial completion`,
			actual: actual.initialCompletionMs,
			baseline: expected.initialCompletionMs,
			relativeMultiplier: lspThresholds.relativeMultiplier,
			absoluteIncrease: lspThresholds.initialAbsoluteIncreaseMs,
			unit: 'ms',
		}));
		checks.push(compareLatency({
			name: `LSP ${expected.modules} modules edited completion`,
			actual: actual.editedCompletionMs,
			baseline: expected.editedCompletionMs,
			relativeMultiplier: lspThresholds.relativeMultiplier,
			absoluteIncrease: lspThresholds.editedAbsoluteIncreaseMs,
			unit: 'ms',
		}));
	}

	checks.push({
		name: 'JS Interop retained heap drift',
		passed: interopReport.driftBytes <= baseline.interop.maxDriftBytes,
		actual: interopReport.driftBytes,
		limit: baseline.interop.maxDriftBytes,
		unit: 'bytes',
		reason: `must be <= ${baseline.interop.maxDriftBytes} bytes`,
	});
	checks.push({
		name: 'JS Interop cache entries before dispose',
		passed: interopReport.cacheEntriesBeforeDispose === baseline.interop.expectedCacheEntriesBeforeDispose,
		actual: interopReport.cacheEntriesBeforeDispose,
		limit: baseline.interop.expectedCacheEntriesBeforeDispose,
		unit: 'entries',
		reason: `must equal ${baseline.interop.expectedCacheEntriesBeforeDispose}`,
	});
	checks.push({
		name: 'JS Interop cache entries after dispose',
		passed: interopReport.cacheEntriesAfterDispose === baseline.interop.expectedCacheEntriesAfterDispose,
		actual: interopReport.cacheEntriesAfterDispose,
		limit: baseline.interop.expectedCacheEntriesAfterDispose,
		unit: 'entries',
		reason: `must equal ${baseline.interop.expectedCacheEntriesAfterDispose}`,
	});

	return {
		schemaVersion: 1,
		generatedAt: new Date().toISOString(),
		passed: checks.every(check => check.passed),
		checks,
	};
}

function compareLatency({ name, actual, baseline, relativeMultiplier, absoluteIncrease, unit }) {
	const relativeLimit = baseline * relativeMultiplier;
	const absoluteLimit = baseline + absoluteIncrease;
	const passed = !(actual > relativeLimit && actual > absoluteLimit);
	return {
		name,
		passed,
		actual,
		baseline,
		relativeLimit,
		absoluteLimit,
		unit,
		reason: `fails only when > ${relativeMultiplier}x baseline and > baseline + ${absoluteIncrease} ${unit}`,
	};
}
