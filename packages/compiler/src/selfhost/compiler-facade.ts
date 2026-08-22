import {
	validateKernelInput,
	validateKernelOutput,
	type KernelInputV1,
	type KernelOutputV1,
} from './contract.js';

export const INTERNAL_COMPILER_FACADE_VERSION = 1 as const;
export const INTERNAL_COMPILER_DEFAULT_SELECTION = 'legacy' as const;

export type InternalCompilerSelection = 'legacy' | 'self-host';
export type InternalKernelCompiler = (
	input: KernelInputV1,
) => KernelOutputV1 | Promise<KernelOutputV1>;

export interface InternalCompilerFacadeDependencies {
	readonly legacyCompiler?: InternalKernelCompiler;
	readonly selfHostCompiler?: InternalKernelCompiler;
}

export interface InternalCompilerFacadeOptions {
	readonly selection?: InternalCompilerSelection;
}

export interface InternalCompilerFacade {
	readonly version: typeof INTERNAL_COMPILER_FACADE_VERSION;
	readonly defaultSelection: typeof INTERNAL_COMPILER_DEFAULT_SELECTION;
	readonly selfHostAvailable: boolean;
	readonly compile: (
		input: unknown,
		options?: InternalCompilerFacadeOptions,
	) => Promise<KernelOutputV1>;
}

export class InternalCompilerFacadeError extends Error {
	public override readonly name = 'InternalCompilerFacadeError';
	public constructor(public readonly path: string, message: string) {
		super(`${path}: ${message}`);
	}
}

/**
 * Create the internal compiler selection boundary.
 *
 * The production default is intentionally fixed to Legacy. Self-host execution
 * is available only when a caller supplies a compiler dependency and selects it
 * explicitly for one invocation. This boundary does not read environment
 * variables, persist selection, or mutate the public compiler API.
 */
export function createInternalCompilerFacade(
	dependencies: InternalCompilerFacadeDependencies = {},
): InternalCompilerFacade {
	const legacyCompiler = dependencies.legacyCompiler ?? lazyLegacyCompiler;
	const selfHostCompiler = dependencies.selfHostCompiler;
	return Object.freeze({
		version: INTERNAL_COMPILER_FACADE_VERSION,
		defaultSelection: INTERNAL_COMPILER_DEFAULT_SELECTION,
		selfHostAvailable: selfHostCompiler !== undefined,
		async compile(
			value: unknown,
			options: InternalCompilerFacadeOptions = {},
		): Promise<KernelOutputV1> {
			const input = validateKernelInput(value);
			const selection = parseSelection(options);
			const compiler = selection === 'legacy'
				? legacyCompiler
				: requireSelfHostCompiler(selfHostCompiler);
			return validateKernelOutput(await compiler(input));
		},
	});
}

async function lazyLegacyCompiler(input: KernelInputV1): Promise<KernelOutputV1> {
	const { compileWithLegacyKernel } = await import('./legacy-adapter.js');
	return compileWithLegacyKernel(input);
}

function parseSelection(value: unknown): InternalCompilerSelection {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new InternalCompilerFacadeError('options', 'expected a plain object');
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new InternalCompilerFacadeError('options', 'expected a plain object');
	}
	const options = value as Record<string, unknown>;
	for (const key of Object.keys(options)) {
		if (key !== 'selection') throw new InternalCompilerFacadeError(`options.${key}`, 'unknown property');
	}
	if (!Object.hasOwn(options, 'selection') || options.selection === undefined) {
		return INTERNAL_COMPILER_DEFAULT_SELECTION;
	}
	if (options.selection !== 'legacy' && options.selection !== 'self-host') {
		throw new InternalCompilerFacadeError(
			'options.selection',
			'expected legacy or self-host',
		);
	}
	return options.selection;
}

function requireSelfHostCompiler(
	compiler: InternalKernelCompiler | undefined,
): InternalKernelCompiler {
	if (compiler === undefined) {
		throw new InternalCompilerFacadeError(
			'options.selection',
			'self-host was selected but no self-host compiler is available',
		);
	}
	return compiler;
}
