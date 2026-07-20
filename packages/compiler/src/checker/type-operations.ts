import { DiagnosticBag } from '../diagnostics/diagnostic.js';
import type { SourceSpan, TypeId } from '../source.js';
import { TypeArena } from '../types/types.js';

export interface TypeOperationsOptions {
	readonly arena: TypeArena;
	readonly diagnostics: DiagnosticBag;
}

/** Pure type-relation and substitution operations shared by checker phases. */
export class TypeOperations {
	readonly #arena: TypeArena;
	readonly #diagnostics: DiagnosticBag;

	public constructor(options: TypeOperationsOptions) {
		this.#arena = options.arena;
		this.#diagnostics = options.diagnostics;
	}

	public isAssignable(source: TypeId, target: TypeId): boolean {
		if (source === this.#arena.error || target === this.#arena.error || this.#arena.equals(source, target) || source === this.#arena.never || target === this.#arena.unknown) return true;
		const targetType = this.#arena.get(target); if (targetType.kind === 'option' && this.isAssignable(source, targetType.value)) return true;
		const sourceType = this.#arena.get(source);
		if (sourceType.kind === 'function' && targetType.kind === 'function') {
			if (sourceType.async !== targetType.async || sourceType.parameters.length !== targetType.parameters.length) return false;
			if (!sourceType.parameters.every((parameter, index) => this.isAssignable(targetType.parameters[index]!, parameter))) return false;
			if (!this.isAssignable(sourceType.result, targetType.result)) return false;
			return targetType.effects.includes('*') || sourceType.effects.every(effect => targetType.effects.includes(effect));
		}
		if (sourceType.kind === 'named' && sourceType.declarationKind === 'alias' && sourceType.underlying !== undefined) return this.isAssignable(sourceType.underlying, target);
		if (targetType.kind === 'named' && targetType.declarationKind === 'alias' && targetType.underlying !== undefined) return this.isAssignable(source, targetType.underlying);
		return false;
	}

	public listElementOf(typeId: TypeId | undefined): TypeId | undefined { if (typeId === undefined) return undefined; const type = this.#arena.get(typeId); return type.kind === 'list' ? type.element : undefined; }
	public setElementOf(typeId: TypeId | undefined): TypeId | undefined { if (typeId === undefined) return undefined; const type = this.#arena.get(typeId); return type.kind === 'set' ? type.element : undefined; }
	public mapKeyOf(typeId: TypeId | undefined): TypeId | undefined { if (typeId === undefined) return undefined; const type = this.#arena.get(typeId); return type.kind === 'map' ? type.key : undefined; }

	public isMustUse(typeId: TypeId, seen = new Set<TypeId>()): boolean {
		if (seen.has(typeId)) return false; seen.add(typeId);
		const type = this.#arena.get(typeId);
		if (type.kind === 'future' || type.kind === 'result') return true;
		if (type.kind === 'foreign') return type.snapshot.mustUse === true;
		if (type.kind === 'named') return type.mustUse === true || type.name === 'Stream' || type.name === 'FileHandle' || (type.declarationKind === 'alias' && type.underlying !== undefined && this.isMustUse(type.underlying, seen));
		return false;
	}

	public supportsHash(typeId: TypeId, seen = new Set<TypeId>()): boolean {
		if (seen.has(typeId)) return true; seen.add(typeId);
		const type = this.#arena.get(typeId);
		if (type.kind === 'primitive') return ['Bool', 'Int', 'BigInt', 'String', 'Unit'].includes(type.name);
		if (type.kind === 'list' || type.kind === 'set' || type.kind === 'option') return this.supportsHash(type.kind === 'list' || type.kind === 'set' ? type.element : type.value, seen);
		if (type.kind === 'map') return this.supportsHash(type.key, seen) && this.supportsHash(type.value, seen);
		if (type.kind === 'result') return this.supportsHash(type.value, seen) && this.supportsHash(type.error, seen);
		if (type.kind === 'tuple') return type.items.every(item => this.supportsHash(item, seen));
		if (type.kind === 'named') {
			if (type.derives?.has('Hash') === true) return true;
			if ((type.declarationKind === 'newtype' || type.declarationKind === 'alias') && type.underlying !== undefined) return this.supportsHash(type.underlying, seen);
			return false;
		}
		return false;
	}

	public containsTypeVariable(typeId: TypeId, seen = new Set<TypeId>()): boolean {
		if (seen.has(typeId)) return false; seen.add(typeId);
		const type = this.#arena.get(typeId);
		if (type.kind === 'typeVariable') return true;
		if (type.kind === 'list' || type.kind === 'set' || type.kind === 'option' || type.kind === 'future') return this.containsTypeVariable(type.kind === 'list' ? type.element : type.kind === 'set' ? type.element : type.value, seen);
		if (type.kind === 'map') return this.containsTypeVariable(type.key, seen) || this.containsTypeVariable(type.value, seen);
		if (type.kind === 'result') return this.containsTypeVariable(type.value, seen) || this.containsTypeVariable(type.error, seen);
		if (type.kind === 'tuple') return type.items.some(item => this.containsTypeVariable(item, seen));
		if (type.kind === 'function') return type.parameters.some(item => this.containsTypeVariable(item, seen)) || this.containsTypeVariable(type.result, seen);
		if (type.kind === 'named') return type.arguments.some(item => this.containsTypeVariable(item, seen));
		return false;
	}

	public supportsDerive(typeId: TypeId, derive: 'Debug', seen = new Set<TypeId>()): boolean {
		if (seen.has(typeId)) return true;
		seen.add(typeId);
		const type = this.#arena.get(typeId);
		if (type.kind === 'primitive') return type.name !== 'Unknown';
		if (type.kind === 'list' || type.kind === 'set' || type.kind === 'option' || type.kind === 'future') return this.supportsDerive(type.kind === 'future' ? type.value : type.kind === 'list' || type.kind === 'set' ? type.element : type.value, derive, seen);
		if (type.kind === 'map') return this.supportsDerive(type.key, derive, seen) && this.supportsDerive(type.value, derive, seen);
		if (type.kind === 'result') return this.supportsDerive(type.value, derive, seen) && this.supportsDerive(type.error, derive, seen);
		if (type.kind === 'tuple') return type.items.every(item => this.supportsDerive(item, derive, seen));
		if (type.kind === 'named') {
			if (type.derives?.has(derive) === true) return true;
			if ((type.declarationKind === 'newtype' || type.declarationKind === 'alias') && type.underlying !== undefined) return this.supportsDerive(type.underlying, derive, seen);
			return false;
		}
		return false;
	}

	public supportsJson(typeId: TypeId, seen = new Set<TypeId>()): boolean {
		if (seen.has(typeId)) return true; seen.add(typeId);
		const type = this.#arena.get(typeId);
		if (type.kind === 'primitive') return ['Bool', 'Int', 'Float', 'String', 'Unit', 'Unknown'].includes(type.name);
		if (type.kind === 'list' || type.kind === 'set' || type.kind === 'option') return this.supportsJson(type.kind === 'list' ? type.element : type.kind === 'set' ? type.element : type.value, seen);
		if (type.kind === 'map') return this.#arena.equals(type.key, this.#arena.string) && this.supportsJson(type.value, seen);
		if (type.kind === 'result') return this.supportsJson(type.value, seen) && this.supportsJson(type.error, seen);
		if (type.kind === 'tuple') return type.items.every(item => this.supportsJson(item, seen));
		if (type.kind === 'named') {
			if (type.derives?.has('Json') === true || type.name === 'JsonError') return true;
			if ((type.declarationKind === 'newtype' || type.declarationKind === 'alias') && type.underlying !== undefined) return this.supportsJson(type.underlying, seen);
			return false;
		}
		return false;
	}

	public supportsDerivedEq(typeId: TypeId, owner: TypeId, seen = new Set<TypeId>()): boolean {
		if (typeId === owner || seen.has(typeId)) return true; seen.add(typeId);
		const type = this.#arena.get(typeId);
		if (type.kind === 'primitive') return ['Bool', 'Int', 'BigInt', 'String', 'Unit'].includes(type.name);
		if (type.kind === 'list' || type.kind === 'set' || type.kind === 'option') return this.supportsDerivedEq(type.kind === 'list' ? type.element : type.kind === 'set' ? type.element : type.value, owner, seen);
		if (type.kind === 'map') return this.supportsDerivedEq(type.key, owner, seen) && this.supportsDerivedEq(type.value, owner, seen);
		if (type.kind === 'result') return this.supportsDerivedEq(type.value, owner, seen) && this.supportsDerivedEq(type.error, owner, seen);
		if (type.kind === 'tuple') return type.items.every(item => this.supportsDerivedEq(item, owner, seen));
		if (type.kind === 'named') {
			if (type.derives?.has('Eq') === true) return true;
			if ((type.declarationKind === 'newtype' || type.declarationKind === 'alias') && type.underlying !== undefined) return this.supportsDerivedEq(type.underlying, owner, seen);
			return false;
		}
		return false;
	}

	public supportsEq(typeId: TypeId, seen = new Set<TypeId>()): boolean {
		if (seen.has(typeId)) return true; seen.add(typeId);
		const type = this.#arena.get(typeId);
		if (type.kind === 'primitive') return ['Bool', 'Int', 'Float', 'BigInt', 'String', 'Unit'].includes(type.name);
		if (type.kind === 'list' || type.kind === 'set' || type.kind === 'option') return this.supportsEq(type.kind === 'list' ? type.element : type.kind === 'set' ? type.element : type.value, seen);
		if (type.kind === 'map') return this.supportsEq(type.key, seen) && this.supportsEq(type.value, seen);
		if (type.kind === 'result') return this.supportsEq(type.value, seen) && this.supportsEq(type.error, seen);
		if (type.kind === 'tuple') return type.items.every(item => this.supportsEq(item, seen));
		if (type.kind === 'named') {
			if (type.derives?.has('Eq') === true) return true;
			if ((type.declarationKind === 'newtype' || type.declarationKind === 'alias') && type.underlying !== undefined) return this.supportsEq(type.underlying, seen);
			return false;
		}
		return false;
	}

	public commonType(types: readonly TypeId[], span: SourceSpan): TypeId {
		if (types.length === 0) return this.#arena.unit;
		let current = types[0]!;
		for (const type of types.slice(1)) {
			if (this.isAssignable(type, current)) continue;
			if (this.isAssignable(current, type)) current = type;
			else { this.#diagnostics.error('L2042', `Incompatible result types ${this.#arena.display(current)} and ${this.#arena.display(type)}`, span); return this.#arena.error; }
		}
		return current;
	}

	public unify(pattern: TypeId, actual: TypeId, substitutions: Map<string, TypeId>): void {
		const patternType = this.#arena.get(pattern);
		const actualType = this.#arena.get(actual);
		if (patternType.kind === 'typeVariable') {
			const existing = substitutions.get(patternType.name);
			if (existing === undefined) substitutions.set(patternType.name, actual);
			return;
		}
		if (patternType.kind === 'list' && actualType.kind === 'list') this.unify(patternType.element, actualType.element, substitutions);
		else if (patternType.kind === 'set' && actualType.kind === 'set') this.unify(patternType.element, actualType.element, substitutions);
		else if (patternType.kind === 'map' && actualType.kind === 'map') { this.unify(patternType.key, actualType.key, substitutions); this.unify(patternType.value, actualType.value, substitutions); }
		else if (patternType.kind === 'tuple' && actualType.kind === 'tuple' && patternType.items.length === actualType.items.length) patternType.items.forEach((item, index) => this.unify(item, actualType.items[index]!, substitutions));
		else if (patternType.kind === 'option' && actualType.kind === 'option') this.unify(patternType.value, actualType.value, substitutions);
		else if (patternType.kind === 'result' && actualType.kind === 'result') { this.unify(patternType.value, actualType.value, substitutions); this.unify(patternType.error, actualType.error, substitutions); }
		else if (patternType.kind === 'future' && actualType.kind === 'future') this.unify(patternType.value, actualType.value, substitutions);
		else if (patternType.kind === 'function' && actualType.kind === 'function' && patternType.parameters.length === actualType.parameters.length) {
			patternType.parameters.forEach((item, index) => this.unify(item, actualType.parameters[index]!, substitutions));
			this.unify(patternType.result, actualType.result, substitutions);
		}
		else if (patternType.kind === 'named' && actualType.kind === 'named' && patternType.definitionId === actualType.definitionId && patternType.arguments.length === actualType.arguments.length) patternType.arguments.forEach((item, index) => this.unify(item, actualType.arguments[index]!, substitutions));
	}

	public substitute(typeId: TypeId, substitutions: ReadonlyMap<string, TypeId>): TypeId {
		const type = this.#arena.get(typeId);
		if (type.kind === 'typeVariable') return substitutions.get(type.name) ?? typeId;
		if (type.kind === 'list') return this.#arena.list(this.substitute(type.element, substitutions));
		if (type.kind === 'set') return this.#arena.set(this.substitute(type.element, substitutions));
		if (type.kind === 'map') return this.#arena.map(this.substitute(type.key, substitutions), this.substitute(type.value, substitutions));
		if (type.kind === 'tuple') return this.#arena.tuple(type.items.map(item => this.substitute(item, substitutions)));
		if (type.kind === 'option') return this.#arena.option(this.substitute(type.value, substitutions));
		if (type.kind === 'result') return this.#arena.result(this.substitute(type.value, substitutions), this.substitute(type.error, substitutions));
		if (type.kind === 'future') return this.#arena.future(this.substitute(type.value, substitutions));
		if (type.kind === 'function') return this.#arena.function(type.parameters.map(item => this.substitute(item, substitutions)), this.substitute(type.result, substitutions), type.typeParameters, type.async, type.effects);
		if (type.kind === 'named' && (type.arguments.some(item => this.containsTypeVariable(item)) || type.fields !== undefined || type.variants !== undefined)) return this.#arena.namedInstance(type, type.arguments.map(item => this.substitute(item, substitutions)), { ...(type.fields === undefined ? {} : { fields: new Map([...type.fields].map(([name, field]) => [name, this.substitute(field, substitutions)])) }), ...(type.variants === undefined ? {} : { variants: new Map([...type.variants].map(([name, values]) => [name, values.map(value => this.substitute(value, substitutions))])) }), ...(type.underlying === undefined ? {} : { underlying: this.substitute(type.underlying, substitutions) }) });
		return typeId;
	}
}
