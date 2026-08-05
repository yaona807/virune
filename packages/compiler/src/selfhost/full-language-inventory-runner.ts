import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { buildProject } from '../project/project.js';
import { snapshotProjectBuild } from './bootstrap-artifact-snapshot.js';
import {
	loadBootstrapCompilerCandidate,
	materializeBootstrapCompilerCandidate,
} from './bootstrap-execution-probe.js';
import { kernelInputFromProjectBuild } from './bootstrap-stage-runner.js';
import {
	compileWithProjectCompilerBoundary,
	hasSelfhostProjectCompilerExports,
	readProjectCompilerCapability,
} from './project-compiler-adapter.js';
import {
	inventoryFromFullLanguageResult,
	type FullLanguageInventory,
} from './full-language-inventory.js';

const snapshotOptions = {
	stage: 'stage0' as const,
	compilerVersion: '1.0.0',
	runtimeAbi: '1',
	interopAbi: '1',
	seedSha256: 'f'.repeat(64),
};

const defaultHeartbeatIntervalMs = 60_000;

export type FullLanguageInventoryPhaseName =
	| 'prepare'
	| 'build-project'
	| 'snapshot-candidate'
	| 'materialize-candidate'
	| 'load-candidate'
	| 'validate-capability'
	| 'kernel-input'
	| 'compile-project-first'
	| 'compile-project-second'
	| 'validate-and-convert'
	| 'cleanup';

export interface FullLanguageInventoryPhaseTiming {
	readonly name: FullLanguageInventoryPhaseName;
	readonly status: 'success' | 'failure';
	readonly startedAt: string;
	readonly completedAt: string;
	readonly durationMs: number;
	readonly error: string | null;
}

export interface FullLanguageInventoryTimingEvidence {
	readonly schemaVersion: 1;
	readonly claim: 'selfhost-full-language-inventory-timing';
	readonly status: 'success' | 'failure';
	readonly startedAt: string;
	readonly completedAt: string;
	readonly durationMs: number;
	readonly heartbeatIntervalMs: number;
	readonly phases: readonly FullLanguageInventoryPhaseTiming[];
	readonly failure: {
		readonly phase: FullLanguageInventoryPhaseName | 'unknown';
		readonly message: string;
	} | null;
}

export interface FullLanguageInventoryProgressEvent {
	readonly schemaVersion: 1;
	readonly kind: 'phase-start' | 'heartbeat' | 'phase-complete' | 'phase-failed';
	readonly phase: FullLanguageInventoryPhaseName;
	readonly elapsedMs: number;
	readonly phaseElapsedMs: number;
	readonly message: string | null;
}

export interface RunFullLanguageInventoryOptions {
	readonly repositoryRoot: string;
	readonly heartbeatIntervalMs?: number;
	readonly now?: () => number;
	readonly onProgress?: (event: FullLanguageInventoryProgressEvent) => void;
	readonly onTimingEvidence?: (
		evidence: FullLanguageInventoryTimingEvidence,
	) => void | Promise<void>;
}

class InventoryTimingSession {
	readonly #startedMs: number;
	readonly #heartbeatIntervalMs: number;
	readonly #now: () => number;
	readonly #onProgress: ((event: FullLanguageInventoryProgressEvent) => void) | undefined;
	readonly #phases: FullLanguageInventoryPhaseTiming[] = [];

	constructor(options: RunFullLanguageInventoryOptions) {
		this.#now = options.now ?? Date.now;
		this.#startedMs = this.#now();
		this.#heartbeatIntervalMs = options.heartbeatIntervalMs ?? defaultHeartbeatIntervalMs;
		if (!Number.isSafeInteger(this.#heartbeatIntervalMs) || this.#heartbeatIntervalMs < 0) {
			throw new Error('heartbeatIntervalMs must be a non-negative safe integer');
		}
		this.#onProgress = options.onProgress;
	}

	async phase<T>(name: FullLanguageInventoryPhaseName, action: () => T | Promise<T>): Promise<T> {
		const startedMs = this.#now();
		this.#emit('phase-start', name, startedMs, null);
		const timer = this.#heartbeatIntervalMs === 0
			? null
			: setInterval(() => {
				this.#emit('heartbeat', name, startedMs, null);
			}, this.#heartbeatIntervalMs);
		try {
			const value = await action();
			const completedMs = this.#now();
			this.#phases.push(phaseTiming(name, 'success', startedMs, completedMs, null));
			this.#emit('phase-complete', name, startedMs, null, completedMs);
			return value;
		} catch (error) {
			const completedMs = this.#now();
			const message = errorMessage(error);
			this.#phases.push(phaseTiming(name, 'failure', startedMs, completedMs, message));
			this.#emit('phase-failed', name, startedMs, message, completedMs);
			throw error;
		} finally {
			if (timer !== null) clearInterval(timer);
		}
	}

	evidence(failure: unknown): FullLanguageInventoryTimingEvidence {
		const completedMs = this.#now();
		let failedPhase: FullLanguageInventoryPhaseName | 'unknown' = 'unknown';
		for (let index = this.#phases.length - 1; index >= 0; index -= 1) {
			const phase = this.#phases[index];
			if (phase?.status === 'failure') {
				failedPhase = phase.name;
				break;
			}
		}
		return {
			schemaVersion: 1,
			claim: 'selfhost-full-language-inventory-timing',
			status: failure === null ? 'success' : 'failure',
			startedAt: timestamp(this.#startedMs),
			completedAt: timestamp(completedMs),
			durationMs: duration(this.#startedMs, completedMs),
			heartbeatIntervalMs: this.#heartbeatIntervalMs,
			phases: [...this.#phases],
			failure: failure === null ? null : {
				phase: failedPhase,
				message: errorMessage(failure),
			},
		};
	}

	#emit(
		kind: FullLanguageInventoryProgressEvent['kind'],
		phase: FullLanguageInventoryPhaseName,
		phaseStartedMs: number,
		message: string | null,
		nowMs = this.#now(),
	): void {
		if (this.#onProgress === undefined) return;
		try {
			this.#onProgress({
				schemaVersion: 1,
				kind,
				phase,
				elapsedMs: duration(this.#startedMs, nowMs),
				phaseElapsedMs: duration(phaseStartedMs, nowMs),
				message,
			});
		} catch {
			// Observability callbacks must not change compiler behavior.
		}
	}
}

export async function runFullLanguageInventory(
	options: RunFullLanguageInventoryOptions,
): Promise<FullLanguageInventory> {
	const timings = new InventoryTimingSession(options);
	const mvpRoot = join(options.repositoryRoot, 'selfhost', 'mvp');
	const temporaryParent = join(options.repositoryRoot, '.test-tmp');
	let runRoot: string | null = null;
	let inventory: FullLanguageInventory | null = null;
	let failure: unknown = null;
	try {
		runRoot = await timings.phase('prepare', async () => {
			await mkdir(temporaryParent, { recursive: true });
			return mkdtemp(join(temporaryParent, 'selfhost-inventory-'));
		});
		const build = await timings.phase('build-project', async () => {
			const result = await buildProject(mvpRoot, { write: false });
			const buildErrors = result.diagnostics.filter(item => item.severity === 'error');
			if (buildErrors.length > 0) {
				throw new Error(`Self-host MVP build failed: ${buildErrors.map(item => `${item.code}:${item.message}`).join('; ')}`);
			}
			return result;
		});
		const artifact = await timings.phase(
			'snapshot-candidate',
			() => snapshotProjectBuild(build, snapshotOptions),
		);
		const candidateRoot = await timings.phase(
			'materialize-candidate',
			() => materializeBootstrapCompilerCandidate(artifact, runRoot as string),
		);
		const compilerModule = await timings.phase(
			'load-candidate',
			() => loadBootstrapCompilerCandidate(candidateRoot, 'dist/main.js'),
		);
		const capability = await timings.phase('validate-capability', () => {
			if (!hasSelfhostProjectCompilerExports(compilerModule)) {
				throw new Error('Generated compiler must export the project compiler boundary');
			}
			const value = readProjectCompilerCapability(compilerModule);
			if (value === null) throw new Error('Generated compiler did not expose project compiler capability');
			return value;
		});
		const input = await timings.phase('kernel-input', () => kernelInputFromProjectBuild(build));
		const first = await timings.phase(
			'compile-project-first',
			() => compileWithProjectCompilerBoundary(compilerModule, input),
		);
		const second = await timings.phase(
			'compile-project-second',
			() => compileWithProjectCompilerBoundary(compilerModule, input),
		);
		inventory = await timings.phase('validate-and-convert', () => {
			if (JSON.stringify(first) !== JSON.stringify(second)) {
				throw new Error('Generated project compiler returned non-deterministic results');
			}
			const value = inventoryFromFullLanguageResult(
				input.sources.map(source => source.path),
				first,
				capability,
			);
			if (value.boundaryBlockers.length > 0) {
				throw new Error(`Full-language inventory boundary regression: ${value.boundaryBlockers.join(', ')}`);
			}
			return value;
		});
	} catch (error) {
		failure = error;
	}
	if (runRoot !== null) {
		try {
			await timings.phase('cleanup', () => rm(runRoot as string, { recursive: true, force: true }));
		} catch (error) {
			failure = combineFailures(failure, error);
		}
	}
	const evidence = timings.evidence(failure);
	if (options.onTimingEvidence !== undefined) {
		try {
			await options.onTimingEvidence(evidence);
		} catch (error) {
			failure = combineFailures(failure, error);
		}
	}
	if (failure !== null) throw failure;
	if (inventory === null) throw new Error('Full-language inventory completed without a result');
	return inventory;
}

export function serializeFullLanguageInventoryTimingEvidence(
	evidence: FullLanguageInventoryTimingEvidence,
): string {
	return `${JSON.stringify(evidence)}\n`;
}

export function formatFullLanguageInventoryProgress(
	event: FullLanguageInventoryProgressEvent,
): string {
	const detail = event.message === null ? '' : ` (${event.message})`;
	return `SELFHOST_INVENTORY_PROGRESS ${event.kind} phase=${event.phase} elapsedMs=${event.elapsedMs} phaseElapsedMs=${event.phaseElapsedMs}${detail}`;
}

function phaseTiming(
	name: FullLanguageInventoryPhaseName,
	status: FullLanguageInventoryPhaseTiming['status'],
	startedMs: number,
	completedMs: number,
	error: string | null,
): FullLanguageInventoryPhaseTiming {
	return {
		name,
		status,
		startedAt: timestamp(startedMs),
		completedAt: timestamp(completedMs),
		durationMs: duration(startedMs, completedMs),
		error,
	};
}

function combineFailures(first: unknown, second: unknown): unknown {
	if (first === null) return second;
	return new AggregateError([first, second], 'Full-language inventory and cleanup/evidence handling both failed');
}

function duration(startedMs: number, completedMs: number): number {
	return Math.max(0, Math.round(completedMs - startedMs));
}

function timestamp(milliseconds: number): string {
	return new Date(milliseconds).toISOString();
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
