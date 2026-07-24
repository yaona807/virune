import {
	evaluatePerformanceRegression,
	parseCliArguments,
	readJsonFile,
	requiredOption,
	writeJsonFile,
} from './performance-benchmark-utils.mjs';

const options = parseCliArguments(process.argv.slice(2));
const baselinePath = requiredOption(options, 'baseline');
const lspPath = requiredOption(options, 'lsp');
const interopPath = requiredOption(options, 'interop');
const outputPath = options.get('output');

const [baseline, lspReport, interopReport] = await Promise.all([
	readJsonFile(baselinePath),
	readJsonFile(lspPath),
	readJsonFile(interopPath),
]);
const result = evaluatePerformanceRegression(baseline, lspReport, interopReport);

console.table(result.checks.map(check => ({
	check: check.name,
	passed: check.passed,
	actual: check.actual,
	limit: check.limit ?? `${check.relativeLimit.toFixed(2)} and ${check.absoluteLimit.toFixed(2)}`,
	unit: check.unit,
})));
console.log(JSON.stringify(result, null, 2));
if (outputPath !== undefined) await writeJsonFile(outputPath, result);
if (!result.passed) {
	console.error('Performance regression threshold exceeded.');
	process.exitCode = 1;
}
