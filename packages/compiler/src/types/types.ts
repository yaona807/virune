import type { ForeignTypeRef, ForeignTypeSnapshot } from '../interop/types.js';
import type { TypeId } from '../source.js';

export type Type =
	| { readonly kind: 'primitive'; readonly name: 'Bool' | 'Int' | 'Float' | 'BigInt' | 'String' | 'Unit' | 'Unknown' | 'Never' | 'InvalidType' }
	| { readonly kind: 'named'; readonly name: string; readonly definitionId: string; readonly declarationKind: 'record' | 'enum' | 'newtype' | 'alias'; readonly arguments: readonly TypeId[]; readonly fields?: ReadonlyMap<string, TypeId>; readonly variants?: ReadonlyMap<string, readonly TypeId[]>; readonly underlying?: TypeId; readonly derives?: ReadonlySet<string>; readonly mustUse?: boolean }
	| { readonly kind: 'function'; readonly parameters: readonly TypeId[]; readonly result: TypeId; readonly typeParameters: readonly string[]; readonly async: boolean; readonly effects: readonly string[] }
	| { readonly kind: 'list'; readonly element: TypeId }
	| { readonly kind: 'map'; readonly key: TypeId; readonly value: TypeId }
	| { readonly kind: 'set'; readonly element: TypeId }
	| { readonly kind: 'tuple'; readonly items: readonly TypeId[] }
	| { readonly kind: 'option'; readonly value: TypeId }
	| { readonly kind: 'result'; readonly value: TypeId; readonly error: TypeId }
	| { readonly kind: 'future'; readonly value: TypeId }
	| { readonly kind: 'typeVariable'; readonly name: string }
	| { readonly kind: 'foreign'; readonly ref: ForeignTypeRef; readonly snapshot: ForeignTypeSnapshot };

export class TypeArena {
	readonly #types: Type[] = [];
	readonly #interned = new Map<string, TypeId>();
	readonly bool = this.add({ kind: 'primitive', name: 'Bool' });
	readonly int = this.add({ kind: 'primitive', name: 'Int' });
	readonly float = this.add({ kind: 'primitive', name: 'Float' });
	readonly bigint = this.add({ kind: 'primitive', name: 'BigInt' });
	readonly string = this.add({ kind: 'primitive', name: 'String' });
	readonly unit = this.add({ kind: 'primitive', name: 'Unit' });
	readonly unknown = this.add({ kind: 'primitive', name: 'Unknown' });
	readonly never = this.add({ kind: 'primitive', name: 'Never' });
	readonly invalid = this.add({ kind: 'primitive', name: 'InvalidType' });
	/** @internal Compatibility alias for checker code; not a user-visible type. */
	readonly error = this.invalid;

	public add(type: Type): TypeId { const id = this.#types.length; this.#types.push(type); return id; }
	public setNamedDetails(id: TypeId, details: { readonly fields?: ReadonlyMap<string, TypeId>; readonly variants?: ReadonlyMap<string, readonly TypeId[]>; readonly underlying?: TypeId; readonly derives?: ReadonlySet<string>; readonly mustUse?: boolean }): void {
		const type = this.get(id);
		if (type.kind !== 'named') return;
		Object.assign(type, details);
	}

	public get(id: TypeId): Type { return this.#types[id] ?? this.#types[this.invalid]!; }
	public option(value: TypeId): TypeId { return this.intern(`option:${value}`, { kind: 'option', value }); }
	public result(value: TypeId, error: TypeId): TypeId { return this.intern(`result:${value}:${error}`, { kind: 'result', value, error }); }
	public future(value: TypeId): TypeId { return this.intern(`future:${value}`, { kind: 'future', value }); }
	public list(element: TypeId): TypeId { return this.intern(`list:${element}`, { kind: 'list', element }); }
	public map(key: TypeId, value: TypeId): TypeId { return this.intern(`map:${key}:${value}`, { kind: 'map', key, value }); }
	public set(element: TypeId): TypeId { return this.intern(`set:${element}`, { kind: 'set', element }); }
	public tuple(items: readonly TypeId[]): TypeId { return this.intern(`tuple:${items.join(',')}`, { kind: 'tuple', items }); }
	public function(parameters: readonly TypeId[], result: TypeId, typeParameters: readonly string[] = [], async = false, effects: readonly string[] = []): TypeId {
		const normalizedEffects = [...effects].sort();
		return this.intern(`fn:${parameters.join(',')}=>${result}:${typeParameters.join(',')}:${async ? 1 : 0}:${normalizedEffects.join(',')}`, { kind: 'function', parameters, result, typeParameters, async, effects: normalizedEffects });
	}
	public variable(name: string): TypeId { return this.add({ kind: 'typeVariable', name }); }
	public foreign(snapshot: ForeignTypeSnapshot): TypeId { return this.intern(`foreign:${snapshot.ref.providerId}:${snapshot.ref.generation}:${snapshot.ref.id}`, { kind: 'foreign', ref: snapshot.ref, snapshot }); }
	public namedInstance(base: Extract<Type, { readonly kind: 'named' }>, argumentsList: readonly TypeId[], details: Partial<Pick<Extract<Type, { readonly kind: 'named' }>, 'fields' | 'variants' | 'underlying' | 'derives' | 'mustUse'>> = {}): TypeId {
		const key = `named:${base.definitionId}<${argumentsList.join(',')}>`;
		const existing = this.#interned.get(key);
		if (existing !== undefined) return existing;
		const id = this.add({ ...base, ...details, arguments: argumentsList });
		this.#interned.set(key, id);
		return id;
	}

	public display(id: TypeId): string {
		const type = this.get(id);
		switch (type.kind) {
			case 'primitive': return type.name === 'InvalidType' ? '<invalid>' : type.name;
			case 'named': return type.arguments.length === 0 ? type.name : `${type.name}<${type.arguments.map(item => this.display(item)).join(', ')}>`;
			case 'function': return `fn(${type.parameters.map(item => this.display(item)).join(', ')}) -> ${this.display(type.result)}${type.effects.length === 0 ? '' : ` uses ${type.effects.join(', ')}`}`;
			case 'list': return `List<${this.display(type.element)}>`;
			case 'map': return `Map<${this.display(type.key)}, ${this.display(type.value)}>`;
			case 'set': return `Set<${this.display(type.element)}>`;
			case 'tuple': return `(${type.items.map(item => this.display(item)).join(', ')})`;
			case 'option': return `Option<${this.display(type.value)}>`;
			case 'result': return `Result<${this.display(type.value)}, ${this.display(type.error)}>`;
			case 'future': return `Future<${this.display(type.value)}>`;
			case 'typeVariable': return type.name;
			case 'foreign': return `js ${type.snapshot.display}`;
		}
	}

	public equals(left: TypeId, right: TypeId): boolean {
		if (left === right) return true;
		const a = this.get(left); const b = this.get(right);
		if (a.kind !== b.kind) return false;
		if (a.kind === 'primitive' && b.kind === 'primitive') return a.name === b.name;
		if (a.kind === 'typeVariable' && b.kind === 'typeVariable') return a.name === b.name;
		if (a.kind === 'named' && b.kind === 'named') return a.definitionId === b.definitionId && this.arrayEquals(a.arguments, b.arguments);
		if (a.kind === 'list' && b.kind === 'list') return this.equals(a.element, b.element);
		if (a.kind === 'set' && b.kind === 'set') return this.equals(a.element, b.element);
		if (a.kind === 'map' && b.kind === 'map') return this.equals(a.key, b.key) && this.equals(a.value, b.value);
		if (a.kind === 'option' && b.kind === 'option') return this.equals(a.value, b.value);
		if (a.kind === 'result' && b.kind === 'result') return this.equals(a.value, b.value) && this.equals(a.error, b.error);
		if (a.kind === 'future' && b.kind === 'future') return this.equals(a.value, b.value);
		if (a.kind === 'tuple' && b.kind === 'tuple') return this.arrayEquals(a.items, b.items);
		if (a.kind === 'function' && b.kind === 'function') return this.arrayEquals(a.parameters, b.parameters) && this.equals(a.result, b.result) && a.async === b.async && a.effects.length === b.effects.length && a.effects.every((effect, index) => effect === b.effects[index]);
		if (a.kind === 'foreign' && b.kind === 'foreign') return a.ref.providerId === b.ref.providerId && a.ref.generation === b.ref.generation && a.ref.id === b.ref.id;
		return false;
	}

	private arrayEquals(left: readonly TypeId[], right: readonly TypeId[]): boolean { return left.length === right.length && left.every((item, index) => this.equals(item, right[index]!)); }
	private intern(key: string, type: Type): TypeId {
		const existing = this.#interned.get(key);
		if (existing !== undefined) return existing;
		const id = this.add(type);
		this.#interned.set(key, id);
		return id;
	}
}
