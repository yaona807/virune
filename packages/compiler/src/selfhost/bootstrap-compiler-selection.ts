import type { BootstrapStageArtifact } from './bootstrap-stage-executor.js';
import {
	evaluateBootstrapRollbackDecision,
	type BootstrapRollbackDecisionInput,
	type BootstrapRollbackDecisionResult,
} from './bootstrap-rollback-decision.js';
import {
	createInternalCompilerFacade,
	type InternalCompilerFacadeDependencies,
	type InternalKernelCompiler,
} from './compiler-facade.js';
import type { KernelOutputV1 } from './contract.js';
import { materializeStageCompilerFacade } from './stage-compiler-facade.js';

export interface BootstrapSelfHostCandidate {
	readonly artifact: BootstrapStageArtifact;
	readonly temporaryRoot: string;
}

export interface BootstrapCompilerSelectionRequest {
	readonly rollbackDecision: BootstrapRollbackDecisionInput;
	readonly input: unknown;
	readonly selfHostCandidate?: BootstrapSelfHostCandidate;
}

export interface BootstrapCompilerSelectionDependencies {
	readonly legacyCompiler?: InternalKernelCompiler;
}

export interface BootstrapCompilerSelectionResult {
	readonly rollback: BootstrapRollbackDecisionResult;
	readonly selection: 'legacy' | 'self-host';
	readonly output: KernelOutputV1;
	readonly materializedStageArtifactSha256: string | null;
}

export class BootstrapCompilerSelectionError extends Error {
	public override readonly name = 'BootstrapCompilerSelectionError';
	public constructor(public readonly path: string, message: string) {
		super(`${path}: ${message}`);
	}
}

/**
 * Evaluate rollback evidence before touching a Self-host compiler candidate.
 *
 * A Legacy rollback must remain usable when the candidate artifact is missing,
 * corrupt, or otherwise impossible to materialize. The Stage artifact is read
 * only after the rollback decision explicitly selects Self-host execution.
 */
export async function executeBootstrapCompilerSelection(
	request: BootstrapCompilerSelectionRequest,
	dependencies: BootstrapCompilerSelectionDependencies = {},
): Promise<BootstrapCompilerSelectionResult> {
	const rollback = evaluateBootstrapRollbackDecision(request.rollbackDecision);
	if (rollback.decision.selection === 'legacy') {
		const facadeDependencies: InternalCompilerFacadeDependencies = {
			...(dependencies.legacyCompiler === undefined
				? {}
				: { legacyCompiler: dependencies.legacyCompiler }),
		};
		const facade = createInternalCompilerFacade(facadeDependencies);
		return {
			rollback,
			selection: 'legacy',
			output: await facade.compile(request.input, { selection: 'legacy' }),
			materializedStageArtifactSha256: null,
		};
	}

	const candidate = request.selfHostCandidate;
	if (candidate === undefined) {
		throw new BootstrapCompilerSelectionError(
			'request.selfHostCandidate',
			'Self-host selection requires a Stage compiler candidate',
		);
	}
	const facade = await materializeStageCompilerFacade(
		candidate.artifact,
		candidate.temporaryRoot,
	);
	try {
		return {
			rollback,
			selection: 'self-host',
			output: await facade.compile(request.input, { selection: 'self-host' }),
			materializedStageArtifactSha256: facade.artifactSha256,
		};
	} finally {
		await facade.dispose();
	}
}
