export interface ViruneResultValue<T, E = unknown> {
	readonly $tag: 'Ok' | 'Err';
	readonly $values: readonly [T] | readonly [E];
}

export interface SelfhostKernelModelModule {
	readonly encodeCanonicalKernelModel: (raw: unknown) => ViruneResultValue<string>;
	readonly decodeKernelModel: (raw: unknown) => ViruneResultValue<unknown>;
	readonly encodeCanonicalTables: (strings: readonly string[], numbers: readonly number[]) => ViruneResultValue<string>;
	readonly runArenaProbe: () => ViruneResultValue<unknown>;
}

export class KernelModelHostError extends Error {
	public override readonly name = 'KernelModelHostError';

	public constructor(
		message: string,
		public readonly details: unknown,
	) {
		super(message);
	}
}

export interface KernelModelHostAdapter {
	readonly encodeCanonicalModel: (raw: unknown) => string;
	readonly decodeModel: (raw: unknown) => unknown;
	readonly encodeCanonicalTables: (strings: readonly string[], numbers: readonly number[]) => string;
	readonly runArenaProbe: () => unknown;
}

/**
 * Adapt the generated Virune kernel-model module to a host-facing exception
 * boundary. The generated module itself remains Result-based; only this host
 * adapter converts an explicit Err value into a JavaScript error for callers.
 */
export function createKernelModelHostAdapter(module: SelfhostKernelModelModule): KernelModelHostAdapter {
	return {
		encodeCanonicalModel(raw: unknown): string {
			return unwrapResult(module.encodeCanonicalKernelModel(raw), 'Kernel model encoding failed');
		},
		decodeModel(raw: unknown): unknown {
			return unwrapResult(module.decodeKernelModel(raw), 'Kernel model decoding failed');
		},
		encodeCanonicalTables(strings: readonly string[], numbers: readonly number[]): string {
			return unwrapResult(module.encodeCanonicalTables(strings, numbers), 'Canonical table encoding failed');
		},
		runArenaProbe(): unknown {
			return unwrapResult(module.runArenaProbe(), 'Kernel arena probe failed');
		},
	};
}

function unwrapResult<T>(result: ViruneResultValue<T>, message: string): T {
	const value = result.$values[0];
	if (result.$tag === 'Ok') return value as T;
	throw new KernelModelHostError(message, value);
}
