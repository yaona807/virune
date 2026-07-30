import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { DifferentialCaseReportV1, DifferentialCorpusReportV1 } from './differential-harness.js';

export async function writeDifferentialArtifacts(
	report: DifferentialCaseReportV1 | DifferentialCorpusReportV1,
	outputDirectory: string,
): Promise<{ readonly jsonPath: string; readonly summaryPath: string }> {
	await mkdir(outputDirectory, { recursive: true });
	const jsonPath = resolve(outputDirectory, 'report.json');
	const summaryPath = resolve(outputDirectory, 'summary.md');
	await writeFile(jsonPath, `${JSON.stringify(report, null, '\t')}\n`, 'utf8');
	await writeFile(summaryPath, 'cases' in report ? formatCorpusSummary(report) : formatDifferentialSummary(report), 'utf8');
	return { jsonPath, summaryPath };
}

export function formatDifferentialSummary(report: DifferentialCaseReportV1): string {
	const lines = [
		'# Self-host differential summary',
		'',
		`- Fixture: \`${report.fixtureId}\``,
		`- Kernels: \`${report.leftKernel}\` vs \`${report.rightKernel}\``,
		`- Result: **${report.status.toUpperCase()}**`,
		`- Differences: ${report.differences.length}`,
		`- Unexplained: ${report.unexplainedDifferences.length}`,
		`- Stale expectations: ${report.staleExpectedDivergences.length}`,
		'',
	];
	if (report.differences.length > 0) {
		lines.push('| Path | Kind | Expected |', '| --- | --- | --- |');
		for (const difference of report.differences) {
			lines.push(`| \`${difference.path}\` | ${difference.kind} | ${report.expectedDifferences.some(item => item.path === difference.path) ? 'yes' : 'no'} |`);
		}
		lines.push('');
	}
	return `${lines.join('\n')}\n`;
}

export function formatCorpusSummary(report: DifferentialCorpusReportV1): string {
	const lines = [
		'# Self-host differential corpus',
		'',
		`Result: **${report.passed ? 'PASS' : 'FAIL'}**`,
		'',
		`- Fixtures: ${report.totals.fixtures}`,
		`- Match: ${report.totals.matched}`,
		`- Expected divergence: ${report.totals.expectedDivergence}`,
		`- Failed: ${report.totals.failed}`,
		'',
		'| Fixture | Result | Differences | Unexplained |',
		'| --- | --- | ---: | ---: |',
	];
	for (const item of report.cases) lines.push(`| \`${item.fixtureId}\` | ${item.status} | ${item.differences.length} | ${item.unexplainedDifferences.length} |`);
	return `${lines.join('\n')}\n`;
}
