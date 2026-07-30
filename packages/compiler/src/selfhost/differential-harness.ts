import {
	normalizeKernelPath,
	validateKernelInput,
	validateKernelOutput,
	type JsonValue,
	type KernelDiagnosticFixV1,
	type KernelDiagnosticV1,
	type KernelInputV1,
	type KernelOutputV1,
	type KernelRelatedDiagnosticV1,
} from './contract.js';

const REPORT_SCHEMA_VERSION = 1 as const;

export interface DifferentialPanicV1 {
	readonly name: string;
	readonly message: string;
	readonly stack: string | null;
}

export interface DifferentialExecutionV1 {
	readonly returnValue: JsonValue;
	readonly stdout: string;
	readonly stderr: string;
	readonly exitCode: number;
	readonly signal: string | null;
	readonly panic: DifferentialPanicV1 | null;
	readonly events: readonly string[];
}

export interface DifferentialKernelV1 {
	readonly name: string;
	readonly compile: (input: KernelInputV1) => Promise<KernelOutputV1>;
	readonly execute?: (input: KernelInputV1, output: KernelOutputV1) => Promise<DifferentialExecutionV1>;
}

export interface ExpectedDivergenceV1 {
	readonly path: string;
	readonly reason: string;
	readonly expiresOn: string;
}

export interface DifferentialFixtureV1 {
	readonly id: string;
	readonly tags: readonly string[];
	readonly input: KernelInputV1;
	readonly expectedDivergences?: readonly ExpectedDivergenceV1[];
}

export interface DifferentialDifferenceV1 {
	readonly path: string;
	readonly kind: 'missing-left' | 'missing-right' | 'type' | 'value';
	readonly leftPresent: boolean;
	readonly rightPresent: boolean;
	readonly left?: JsonValue;
	readonly right?: JsonValue;
}

export interface DifferentialSideResultV1 {
	readonly compiler: {
		readonly output: KernelOutputV1 | null;
		readonly panic: DifferentialPanicV1 | null;
	};
	readonly runtime: DifferentialExecutionV1 | null;
}

export interface DifferentialCaseReportV1 {
	readonly schemaVersion: typeof REPORT_SCHEMA_VERSION;
	readonly fixtureId: string;
	readonly leftKernel: string;
	readonly rightKernel: string;
	readonly status: 'match' | 'expected-divergence' | 'failed';
	readonly passed: boolean;
	readonly left: DifferentialSideResultV1;
	readonly right: DifferentialSideResultV1;
	readonly differences: readonly DifferentialDifferenceV1[];
	readonly expectedDifferences: readonly DifferentialDifferenceV1[];
	readonly unexplainedDifferences: readonly DifferentialDifferenceV1[];
	readonly staleExpectedDivergences: readonly ExpectedDivergenceV1[];
}

export interface DifferentialCorpusReportV1 {
	readonly schemaVersion: typeof REPORT_SCHEMA_VERSION;
	readonly passed: boolean;
	readonly cases: readonly DifferentialCaseReportV1[];
	readonly totals: {
		readonly fixtures: number;
		readonly matched: number;
		readonly expectedDivergence: number;
		readonly failed: number;
	};
}

export class DifferentialPolicyError extends Error {
	public override readonly name = 'DifferentialPolicyError';
}

export async function runDifferentialCase({
	fixtureId,
	input: rawInput,
	left,
	right,
	expectedDivergences = [],
	today = new Date().toISOString().slice(0, 10),
}: {
	readonly fixtureId: string;
	readonly input: KernelInputV1;
	readonly left: DifferentialKernelV1;
	readonly right: DifferentialKernelV1;
	readonly expectedDivergences?: readonly ExpectedDivergenceV1[];
	readonly today?: string;
}): Promise<DifferentialCaseReportV1> {
	if (fixtureId.trim() === '') throw new DifferentialPolicyError('fixtureId must not be empty');
	const input = validateKernelInput(rawInput);
	const policies = validateExpectedDivergences(expectedDivergences, today);
	const [leftResult, rightResult] = await Promise.all([runKernel(left, input), runKernel(right, input)]);
	const normalizedLeft = normalizeSideResult(leftResult);
	const normalizedRight = normalizeSideResult(rightResult);
	const differences: DifferentialDifferenceV1[] = [];
	collectDifferences(normalizedLeft, normalizedRight, '$', differences);
	const expectedDifferences = differences.filter(difference => policies.some(policy => policy.path === difference.path));
	const unexplainedDifferences = differences.filter(difference => !policies.some(policy => policy.path === difference.path));
	const staleExpectedDivergences = policies.filter(policy => !differences.some(difference => difference.path === policy.path));
	const passed = unexplainedDifferences.length === 0 && staleExpectedDivergences.length === 0;
	const status = !passed ? 'failed' : differences.length === 0 ? 'match' : 'expected-divergence';
	return {
		schemaVersion: REPORT_SCHEMA_VERSION,
		fixtureId,
		leftKernel: left.name,
		rightKernel: right.name,
		status,
		passed,
		left: normalizedLeft,
		right: normalizedRight,
		differences,
		expectedDifferences,
		unexplainedDifferences,
		staleExpectedDivergences,
	};
}

export async function runDifferentialCorpus({
	fixtures,
	left,
	right,
	today,
}: {
	readonly fixtures: readonly DifferentialFixtureV1[];
	readonly left: DifferentialKernelV1;
	readonly right: DifferentialKernelV1;
	readonly today?: string;
}): Promise<DifferentialCorpusReportV1> {
	const identifiers = new Set<string>();
	const reports: DifferentialCaseReportV1[] = [];
	for (const fixture of [...fixtures].sort((a, b) => a.id.localeCompare(b.id))) {
		if (identifiers.has(fixture.id)) throw new DifferentialPolicyError(`duplicate fixture id ${fixture.id}`);
		identifiers.add(fixture.id);
		reports.push(await runDifferentialCase({
			fixtureId: fixture.id,
			input: fixture.input,
			left,
			right,
			...(fixture.expectedDivergences === undefined ? {} : { expectedDivergences: fixture.expectedDivergences }),
			...(today === undefined ? {} : { today }),
		}));
	}
	return {
		schemaVersion: REPORT_SCHEMA_VERSION,
		passed: reports.every(report => report.passed),
		cases: reports,
		totals: {
			fixtures: reports.length,
			matched: reports.filter(report => report.status === 'match').length,
			expectedDivergence: reports.filter(report => report.status === 'expected-divergence').length,
			failed: reports.filter(report => report.status === 'failed').length,
		},
	};
}

async function runKernel(kernel: DifferentialKernelV1, input: KernelInputV1): Promise<DifferentialSideResultV1> {
	try {
		const output = validateKernelOutput(await kernel.compile(input));
		let runtime: DifferentialExecutionV1 | null = null;
		if (kernel.execute !== undefined && output.accepted) {
			try { runtime = normalizeExecution(await kernel.execute(input, output)); }
			catch (error) { runtime = executionFailureFromError(error); }
		}
		return { compiler: { output, panic: null }, runtime };
	} catch (error) {
		return { compiler: { output: null, panic: panicFromError(error) }, runtime: null };
	}
}

function normalizeSideResult(result: DifferentialSideResultV1): DifferentialSideResultV1 {
	return {
		compiler: {
			output: result.compiler.output === null ? null : normalizeOutput(result.compiler.output),
			panic: result.compiler.panic === null ? null : normalizePanic(result.compiler.panic),
		},
		runtime: result.runtime === null ? null : normalizeExecution(result.runtime),
	};
}

function normalizeOutput(output: KernelOutputV1): KernelOutputV1 {
	return {
		...output,
		diagnostics: [...output.diagnostics].map(normalizeDiagnostic).sort((a, b) => diagnosticKey(a).localeCompare(diagnosticKey(b))),
		emittedModules: [...output.emittedModules].map(module => ({
			...module,
			sourcePath: normalizeKernelPath(module.sourcePath),
			outputPath: normalizeKernelPath(module.outputPath),
			code: normalizeText(module.code),
			sourceMap: normalizeSourceMap(module.sourceMap),
		})).sort((a, b) => `${a.sourcePath}\0${a.outputPath}`.localeCompare(`${b.sourcePath}\0${b.outputPath}`)),
		dependencies: [...output.dependencies]
			.map(item => canonicalJson(item) as unknown as KernelOutputV1['dependencies'][number])
			.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
		exportedSymbols: [...output.exportedSymbols]
			.map(item => canonicalJson(item) as unknown as KernelOutputV1['exportedSymbols'][number])
			.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
		stats: canonicalJson(output.stats) as unknown as KernelOutputV1['stats'],
	};
}

function normalizeDiagnostic(diagnostic: KernelDiagnosticV1): KernelDiagnosticV1 {
	const related = diagnostic.related === undefined
		? undefined
		: [...diagnostic.related]
			.map(item => canonicalJson(item) as unknown as KernelRelatedDiagnosticV1)
			.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
	const fixes = diagnostic.fixes === undefined
		? undefined
		: [...diagnostic.fixes]
			.map(item => canonicalJson(item) as unknown as KernelDiagnosticFixV1)
			.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
	return canonicalJson({
		...diagnostic,
		message: normalizeText(diagnostic.message),
		...(diagnostic.sourcePath === undefined ? {} : { sourcePath: normalizeKernelPath(diagnostic.sourcePath) }),
		...(related === undefined ? {} : { related }),
		...(fixes === undefined ? {} : { fixes }),
	}) as unknown as KernelDiagnosticV1;
}

function diagnosticKey(diagnostic: KernelDiagnosticV1): string {
	return [diagnostic.sourcePath ?? '', String(diagnostic.span.start.offset).padStart(12, '0'), diagnostic.code, diagnostic.severity, diagnostic.message].join('\0');
}

function normalizeSourceMap(value: string): string {
	if (value.trim() === '') return '';
	try { return JSON.stringify(canonicalJson(JSON.parse(value) as unknown)); }
	catch { return normalizeText(value); }
}

function normalizeExecution(execution: DifferentialExecutionV1): DifferentialExecutionV1 {
	return {
		returnValue: canonicalJson(execution.returnValue),
		stdout: normalizeText(execution.stdout),
		stderr: normalizeText(execution.stderr),
		exitCode: execution.exitCode,
		signal: execution.signal,
		panic: execution.panic === null ? null : normalizePanic(execution.panic),
		events: execution.events.map(normalizeText),
	};
}

function collectDifferences(left: unknown, right: unknown, path: string, output: DifferentialDifferenceV1[]): void {
	if (Object.is(left, right)) return;
	if (left === undefined || right === undefined) {
		output.push(difference(path, left, right, left === undefined ? 'missing-left' : 'missing-right'));
		return;
	}
	if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') {
		output.push(difference(path, left, right, typeof left === typeof right ? 'value' : 'type'));
		return;
	}
	if (Array.isArray(left) || Array.isArray(right)) {
		if (!Array.isArray(left) || !Array.isArray(right)) {
			output.push(difference(path, left, right, 'type'));
			return;
		}
		for (let index = 0; index < Math.max(left.length, right.length); index++) collectDifferences(left[index], right[index], `${path}[${index}]`, output);
		return;
	}
	const leftRecord = left as Record<string, unknown>;
	const rightRecord = right as Record<string, unknown>;
	for (const key of [...new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)])].sort()) {
		collectDifferences(leftRecord[key], rightRecord[key], `${path}.${key}`, output);
	}
}

function difference(path: string, left: unknown, right: unknown, kind: DifferentialDifferenceV1['kind']): DifferentialDifferenceV1 {
	return {
		path,
		kind,
		leftPresent: left !== undefined,
		rightPresent: right !== undefined,
		...(left === undefined ? {} : { left: canonicalJson(left) }),
		...(right === undefined ? {} : { right: canonicalJson(right) }),
	};
}

function validateExpectedDivergences(values: readonly ExpectedDivergenceV1[], today: string): readonly ExpectedDivergenceV1[] {
	if (!/^\d{4}-\d{2}-\d{2}$/u.test(today)) throw new DifferentialPolicyError(`invalid comparison date ${today}`);
	const paths = new Set<string>();
	return values.map((value, index) => {
		if (!value.path.startsWith('$.')) throw new DifferentialPolicyError(`expected divergence ${index} path must start with $.`);
		if (paths.has(value.path)) throw new DifferentialPolicyError(`duplicate expected divergence path ${value.path}`);
		paths.add(value.path);
		if (value.reason.trim() === '') throw new DifferentialPolicyError(`expected divergence ${value.path} requires a reason`);
		if (!/^\d{4}-\d{2}-\d{2}$/u.test(value.expiresOn)) throw new DifferentialPolicyError(`expected divergence ${value.path} has invalid expiry`);
		if (value.expiresOn < today) throw new DifferentialPolicyError(`expected divergence ${value.path} expired on ${value.expiresOn}`);
		return { path: value.path, reason: value.reason.trim(), expiresOn: value.expiresOn };
	});
}

function canonicalJson(value: unknown): JsonValue {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
	if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
	if (typeof value === 'bigint') return { $type: 'bigint', value: value.toString() };
	if (value === undefined) return { $type: 'undefined' };
	if (Array.isArray(value)) return value.map(canonicalJson);
	if (typeof value !== 'object') return { $type: typeof value, value: String(value) };
	const record = value as Record<string, unknown>;
	const output: Record<string, JsonValue> = {};
	for (const key of Object.keys(record).sort()) output[key] = canonicalJson(record[key]);
	return output;
}

function normalizeText(value: string): string {
	return value.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
}

function panicFromError(error: unknown): DifferentialPanicV1 {
	if (error instanceof Error) return normalizePanic({ name: error.name, message: error.message, stack: error.stack ?? null });
	return { name: 'UnknownPanic', message: String(error), stack: null };
}

function normalizePanic(panic: DifferentialPanicV1): DifferentialPanicV1 {
	return {
		name: panic.name,
		message: normalizeText(panic.message),
		stack: panic.stack === null ? null : normalizeText(panic.stack),
	};
}

function executionFailureFromError(error: unknown): DifferentialExecutionV1 {
	return { returnValue: null, stdout: '', stderr: '', exitCode: 1, signal: null, panic: panicFromError(error), events: [] };
}
