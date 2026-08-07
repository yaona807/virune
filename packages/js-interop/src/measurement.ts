import type {
	InteropDecision,
	InteropReasonCode,
	InteropSafetyGate,
	InteropTargetProfile,
} from './classifier.js';

const GATES: readonly InteropSafetyGate[] = ['AUTO_SAFE', 'ADAPTER_REQUIRED', 'SEMANTICS_REQUIRED', 'UNRESOLVED'];
const GATE_RANK: Readonly<Record<InteropSafetyGate, number>> = {
	AUTO_SAFE: 0,
	ADAPTER_REQUIRED: 1,
	SEMANTICS_REQUIRED: 2,
	UNRESOLVED: 3,
};

export interface InteropMeasurementSample {
	/** Stable package identity, normally name@version. */
	readonly packageId: string;
	readonly target: InteropTargetProfile;
	/** Canonical public callable/property endpoint, with overloads grouped upstream. */
	readonly endpointId: string;
	/** Canonical normalized Fact/Plan shape, not merely a display type string. */
	readonly shapeId: string;
	readonly decision: InteropDecision;
}

export interface GateDistribution {
	readonly total: number;
	readonly counts: Readonly<Record<InteropSafetyGate, number>>;
	readonly rates: Readonly<Record<InteropSafetyGate, number>>;
}

export interface PackageWeightedDistribution {
	readonly packageTargetCount: number;
	/** Mean of each package-target's local gate rate; every package-target has equal weight. */
	readonly meanRates: Readonly<Record<InteropSafetyGate, number>>;
}

export interface ShapeConflict {
	readonly target: InteropTargetProfile;
	readonly shapeId: string;
	readonly gates: readonly InteropSafetyGate[];
}

export interface InteropMeasurementSummary {
	readonly endpointWeighted: GateDistribution;
	readonly packageTargetWeighted: PackageWeightedDistribution;
	readonly uniqueShapeWeighted: GateDistribution;
	readonly shapeConflicts: readonly ShapeConflict[];
	readonly reasonCounts: Readonly<Partial<Record<InteropReasonCode, number>>>;
	readonly packageTargetCount: number;
	readonly endpointCount: number;
	readonly uniqueShapeCount: number;
}

export function summarizeInteropMeasurements(samples: readonly InteropMeasurementSample[]): InteropMeasurementSummary {
	assertUnique(samples, sample => `${sample.packageId}\u0000${sample.target}\u0000${sample.endpointId}`, 'canonical endpoint');
	const endpointWeighted = distribution(samples.map(sample => sample.decision.gate));
	const packageGroups = groupBy(samples, sample => `${sample.packageId}\u0000${sample.target}`);
	const packageRates = emptyNumberRecord();
	for (const group of packageGroups.values()) {
		const local = distribution(group.map(sample => sample.decision.gate));
		for (const gate of GATES) packageRates[gate] += local.rates[gate];
	}
	const packageTargetCount = packageGroups.size;
	const packageTargetWeighted: PackageWeightedDistribution = {
		packageTargetCount,
		meanRates: mapNumberRecord(packageRates, value => packageTargetCount === 0 ? 0 : value / packageTargetCount),
	};

	const shapeGroups = groupBy(samples, sample => `${sample.target}\u0000${sample.shapeId}`);
	const shapeGates: InteropSafetyGate[] = [];
	const shapeConflicts: ShapeConflict[] = [];
	for (const group of shapeGroups.values()) {
		const exemplar = group[0]!;
		const gates = [...new Set(group.map(sample => sample.decision.gate))].sort((left, right) => GATE_RANK[left] - GATE_RANK[right]);
		if (gates.length > 1) shapeConflicts.push({ target: exemplar.target, shapeId: exemplar.shapeId, gates });
		shapeGates.push(gates.reduce((worst, gate) => GATE_RANK[gate] > GATE_RANK[worst] ? gate : worst, gates[0] ?? 'UNRESOLVED'));
	}

	const reasonCounts: Partial<Record<InteropReasonCode, number>> = {};
	for (const sample of samples) {
		for (const reason of new Set(sample.decision.reasons)) reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
	}

	return {
		endpointWeighted,
		packageTargetWeighted,
		uniqueShapeWeighted: distribution(shapeGates),
		shapeConflicts,
		reasonCounts,
		packageTargetCount,
		endpointCount: samples.length,
		uniqueShapeCount: shapeGroups.size,
	};
}

export type GoldAutoSafetyLabel = 'SAFE_AUTO' | 'NOT_SAFE_AUTO';

export interface InteropGoldSample {
	readonly id: string;
	readonly expectedAutoSafety: GoldAutoSafetyLabel;
	readonly actual: InteropDecision;
	readonly expectedGate?: InteropSafetyGate;
}

export interface InteropGoldEvaluation {
	readonly sampleCount: number;
	readonly trueAutoSafe: number;
	readonly falseSafeCount: number;
	readonly falseNotSafeCount: number;
	readonly trueNotSafe: number;
	/** False-safe rate among samples that are known not to be safe for AUTO_SAFE. */
	readonly falseSafeRate: number | null;
	/** False-safe cases as a share of the entire reviewed corpus. */
	readonly falseSafeShare: number;
	readonly autoSafePrecision: number | null;
	readonly autoSafeRecall: number | null;
	readonly exactGateMatches: number;
	readonly exactGateCompared: number;
}

export function evaluateGoldCorpus(samples: readonly InteropGoldSample[]): InteropGoldEvaluation {
	assertUnique(samples, sample => sample.id, 'gold sample');
	let trueAutoSafe = 0;
	let falseSafeCount = 0;
	let falseNotSafeCount = 0;
	let trueNotSafe = 0;
	let exactGateMatches = 0;
	let exactGateCompared = 0;
	for (const sample of samples) {
		const predictedSafe = sample.actual.gate === 'AUTO_SAFE';
		const expectedSafe = sample.expectedAutoSafety === 'SAFE_AUTO';
		if (predictedSafe && expectedSafe) trueAutoSafe++;
		else if (predictedSafe) falseSafeCount++;
		else if (expectedSafe) falseNotSafeCount++;
		else trueNotSafe++;
		if (sample.expectedGate !== undefined) {
			exactGateCompared++;
			if (sample.actual.gate === sample.expectedGate) exactGateMatches++;
		}
	}
	const predictedSafeCount = trueAutoSafe + falseSafeCount;
	const expectedSafeCount = trueAutoSafe + falseNotSafeCount;
	const expectedNotSafeCount = falseSafeCount + trueNotSafe;
	return {
		sampleCount: samples.length,
		trueAutoSafe,
		falseSafeCount,
		falseNotSafeCount,
		trueNotSafe,
		falseSafeRate: expectedNotSafeCount === 0 ? null : falseSafeCount / expectedNotSafeCount,
		falseSafeShare: samples.length === 0 ? 0 : falseSafeCount / samples.length,
		autoSafePrecision: predictedSafeCount === 0 ? null : trueAutoSafe / predictedSafeCount,
		autoSafeRecall: expectedSafeCount === 0 ? null : trueAutoSafe / expectedSafeCount,
		exactGateMatches,
		exactGateCompared,
	};
}

function distribution(gates: readonly InteropSafetyGate[]): GateDistribution {
	const counts = emptyNumberRecord();
	for (const gate of gates) counts[gate]++;
	const total = gates.length;
	return { total, counts, rates: mapNumberRecord(counts, value => total === 0 ? 0 : value / total) };
}

function emptyNumberRecord(): Record<InteropSafetyGate, number> {
	return { AUTO_SAFE: 0, ADAPTER_REQUIRED: 0, SEMANTICS_REQUIRED: 0, UNRESOLVED: 0 };
}

function mapNumberRecord(record: Readonly<Record<InteropSafetyGate, number>>, mapper: (value: number) => number): Record<InteropSafetyGate, number> {
	return {
		AUTO_SAFE: mapper(record.AUTO_SAFE),
		ADAPTER_REQUIRED: mapper(record.ADAPTER_REQUIRED),
		SEMANTICS_REQUIRED: mapper(record.SEMANTICS_REQUIRED),
		UNRESOLVED: mapper(record.UNRESOLVED),
	};
}

function groupBy<T>(values: readonly T[], keyOf: (value: T) => string): Map<string, T[]> {
	const groups = new Map<string, T[]>();
	for (const value of values) {
		const key = keyOf(value);
		const group = groups.get(key);
		if (group === undefined) groups.set(key, [value]);
		else group.push(value);
	}
	return groups;
}

function assertUnique<T>(values: readonly T[], keyOf: (value: T) => string, label: string): void {
	const seen = new Set<string>();
	for (const value of values) {
		const key = keyOf(value);
		if (seen.has(key)) throw new Error(`Duplicate ${label}: ${JSON.stringify(key)}`);
		seen.add(key);
	}
}
