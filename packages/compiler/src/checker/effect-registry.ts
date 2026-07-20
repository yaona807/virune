export interface EffectDefinition {
	readonly name: string;
	readonly definitionId: string;
	readonly builtin: boolean;
}

/** Registry for capability/effect declarations. Effects are not value types. */
export class EffectRegistry {
	readonly #definitions = new Map<string, EffectDefinition>();

	public registerBuiltin(name: string): void {
		this.#definitions.set(name, { name, definitionId: `std:${name}`, builtin: true });
	}

	public has(name: string): boolean { return this.#definitions.has(name); }
	public get(name: string): EffectDefinition | undefined { return this.#definitions.get(name); }
	public entries(): IterableIterator<[string, EffectDefinition]> { return this.#definitions.entries(); }
}
