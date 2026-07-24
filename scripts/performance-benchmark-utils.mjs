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
	for (const [index, value] of values.entries()) finiteNumber(value, `median sample ${index}`);
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
	if (!Array.isArray(baseline.lsp?.modules)) throw new Error('Performance baseline must contain lsp.modules');
	if (!Array.isArray(lspReport.report)) throw new Error('LSP report must contain report entries');

	const checks = [];
	const lspThresholds = baseline.lsp.thresholds;
	const relativeMultiplier = positiveFiniteNumber(lspThresholds?.relativeMultiplier, 'lsp.thresholds.relativeMultiplier');
	const initialAbsoluteIncreaseMs = nonNegativeFiniteNumber(lspThresholds?.initialAbsoluteIncreaseMs, 'lsp.thresholds.initialAbsoluteIncreaseMs');
	const editedAbsoluteIncreaseMs = nonNegativeFiniteNumber(lspThresholds?.editedAbsoluteIncreaseMs, 'lsp.thresholds.editedAbsoluteIncreaseMs');
	const actualByModules = new Map();

	for (const [index, entry] of lspReport.report.entries()) {
		const modules = positiveInteger(entry?.modules, `lsp.report[${index}].modules`);
		if (actualByModules.has(modules)) throw new Error(`LSP report contains duplicate ${modules}-module entries`);
		actualByModules.set(modules, entry);
	}

	for (const [index, expected] of baseline.lsp.modules.entries()) {
		const modules = positiveInteger(expected?.modules, `baseline.lsp.modules[${index}].modules`);
		const actual = actualByModules.get(modules);
		if (actual === undefined) throw new Error(`LSP report is missing ${modules} modules`);
		checks.push(compareLatency({
			name: `LSP ${modules} modules initial completion`,
			actual: finiteNumber(actual.initialCompletionMs, `LSP ${modules} initial completion`),
			baseline: positiveFiniteNumber(expected.initialCompletionMs, `baseline LSP ${modules} initial completion`),
			relativeMultiplier,
			absoluteIncrease: initialAbsoluteIncreaseMs,
			unit: 'ms',
		}));
		checks.push(compareLatency({
			name: `LSP ${modules} modules edited completion`,
			actual: finiteNumber(actual.editedCompletionMs, `LSP ${modules} edited completion`),
			baseline: positiveFiniteNumber(expected.editedCompletionMs, `baseline LSP ${modules} edited completion`),
			relativeMultiplier,
			absoluteIncrease: editedAbsoluteIncreaseMs,
			unit: 'ms',
		}));
	}

	const maxDriftBytes = nonNegativeFiniteNumber(baseline.interop?.maxDriftBytes, 'interop.maxDriftBytes');
	const driftBytes = finiteNumber(interopReport.driftBytes, 'interop report driftBytes');
	const expectedCacheEntriesBeforeDispose = nonNegativeInteger(
		baseline.interop?.expectedCacheEntriesBeforeDispose,
		'interop.expectedCacheEntriesBeforeDispose',
	);
	const expectedCacheEntriesAfterDispose = nonNegativeInteger(
		baseline.interop?.expectedCacheEntriesAfterDispose,
		'interop.expectedCacheEntriesAfterDispose',
	);
	const cacheEntriesBeforeDispose = nonNegativeInteger(
		interopReport.cacheEntriesBeforeDispose,
		'interop report cacheEntriesBeforeDispose',
	);
	const cacheEntriesAfterDispose = nonNegativeInteger(
		interopReport.cacheEntriesAfterDispose,
		'interop report cacheEntriesAfterDispose',
	);

	checks.push({
		name: 'JS Interop retained heap drift',
		passed: driftBytes <= maxDriftBytes,
		actual: driftBytes,
		limit: maxDriftBytes,
		unit: 'bytes',
		reason: `must be <= ${maxDriftBytes} bytes`,
	});
	checks.push({
		name: 'JS Interop cache entries before dispose',
		passed: cacheEntriesBeforeDispose === expectedCacheEntriesBeforeDispose,
		actual: cacheEntriesBeforeDispose,
		limit: expectedCacheEntriesBeforeDispose,
		unit: 'entries',
		reason: `must equal ${expectedCacheEntriesBeforeDispose}`,
	});
	checks.push({
		name: 'JS Interop cache entries after dispose',
		passed: cacheEntriesAfterDispose === expectedCacheEntriesAfterDispose,
		actual: cacheEntriesAfterDispose,
		limit: expectedCacheEntriesAfterDispose,
		unit: 'entries',
		reason: `must equal ${expectedCacheEntriesAfterDispose}`,
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

function finiteNumber(value, name) {
	if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${name} must be a finite number`);
	return value;
}

function positiveFiniteNumber(value, name) {
	const number = finiteNumber(value, name);
	if (number <= 0) throw new Error(`${name} must be greater than zero`);
	return number;
}

function nonNegativeFiniteNumber(value, name) {
	const number = finiteNumber(value, name);
	if (number < 0) throw new Error(`${name} must not be negative`);
	return number;
}

function positiveInteger(value, name) {
	if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
	return value;
}

function nonNegativeInteger(value, name) {
	if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
	return value;
}
