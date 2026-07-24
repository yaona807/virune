import { resolve } from 'node:path';
import type {
	ForeignCallResolution,
	ForeignTypeRef,
	ForeignTypeSnapshot,
	InteropArgumentType,
	JsImportRequest,
	JsImportResolution,
	JsInteropProvider,
} from '@virune/compiler/experimental';
import { TypeScriptInteropProvider, type TypeScriptInteropProviderOptions } from './index.js';

export interface CachedTypeScriptInteropProviderOptions extends TypeScriptInteropProviderOptions {
	readonly createProvider?: (options: TypeScriptInteropProviderOptions) => TypeScriptInteropProvider;
}

/**
 * Generation-scoped cache around the TypeScript provider.
 *
 * A cached resolution retains the underlying Program and TypeChecker only for
 * the lifetime of this wrapper. Disposing the generation clears the cache and
 * drops the provider reference so all Program/AST/type handles can be reclaimed.
 */
export class CachedTypeScriptInteropProvider implements JsInteropProvider {
	readonly id: string;
	readonly version: string;
	readonly generation: number;
	readonly #cache = new Map<string, JsImportResolution>();
	#provider: TypeScriptInteropProvider | undefined;

	public constructor(options: CachedTypeScriptInteropProviderOptions) {
		const createProvider = options.createProvider ?? (providerOptions => new TypeScriptInteropProvider(providerOptions));
		const provider = createProvider(options);
		this.#provider = provider;
		this.id = provider.id;
		this.version = provider.version;
		this.generation = provider.generation;
	}

	public resolveImport(request: JsImportRequest): JsImportResolution {
		const key = importCacheKey(request);
		const cached = this.#cache.get(key);
		if (cached !== undefined) return cached;
		const resolution = this.#requireProvider().resolveImport(request);
		this.#cache.set(key, resolution);
		return resolution;
	}

	public getProperty(type: ForeignTypeRef, name: string): ForeignTypeSnapshot | undefined {
		return this.#requireProvider().getProperty(type, name);
	}

	public resolveCall(type: ForeignTypeRef, argumentsList: readonly InteropArgumentType[]): ForeignCallResolution | undefined {
		return this.#requireProvider().resolveCall(type, argumentsList);
	}

	public resolveConstruct(type: ForeignTypeRef, argumentsList: readonly InteropArgumentType[]): ForeignCallResolution | undefined {
		return this.#requireProvider().resolveConstruct(type, argumentsList);
	}

	public getAwaitedType(type: ForeignTypeRef): ForeignTypeSnapshot | undefined {
		return this.#requireProvider().getAwaitedType(type);
	}

	public display(type: ForeignTypeRef): string {
		return this.#requireProvider().display(type);
	}

	public dispose(): void {
		const provider = this.#provider;
		this.#provider = undefined;
		this.#cache.clear();
		provider?.dispose();
	}

	public get cachedImportCount(): number {
		return this.#cache.size;
	}

	#requireProvider(): TypeScriptInteropProvider {
		if (this.#provider === undefined) throw new Error('Disposed JavaScript interop provider generation');
		return this.#provider;
	}
}

function importCacheKey(request: JsImportRequest): string {
	return [
		resolve(request.containingFile),
		request.moduleSpecifier,
		request.kind,
		request.importedName ?? '',
		request.platform,
	].join('\0');
}
