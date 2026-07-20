import type { AstNode, Declaration } from '../ast/nodes.js';
import type { SourceSpan, SymbolId, TypeId } from '../source.js';
import { IdGenerator } from '../source.js';

export type SymbolKind = 'function' | 'variable' | 'parameter' | 'type' | 'variant' | 'extern' | 'builtin' | 'import';
export interface SymbolInfo {
	readonly id: SymbolId;
	readonly name: string;
	readonly kind: SymbolKind;
	readonly span: SourceSpan;
	readonly declaration?: AstNode | Declaration;
	typeId: TypeId;
	readonly mutable: boolean;
	readonly public: boolean;
	readonly typeOnly: boolean;
	readonly constant: boolean;
}

export class Scope {
	readonly #symbols = new Map<string, SymbolInfo>();
	public constructor(readonly parent?: Scope) {}
	public define(symbol: SymbolInfo): boolean {
		if (this.lookupCurrent(symbol.name) !== undefined || this.parent?.lookup(symbol.name) !== undefined) return false;
		this.#symbols.set(symbol.name, symbol); return true;
	}
	public defineAllowParent(symbol: SymbolInfo): boolean {
		if (this.lookupCurrent(symbol.name) !== undefined) return false;
		this.#symbols.set(symbol.name, symbol); return true;
	}
	public lookupCurrent(name: string): SymbolInfo | undefined { return this.#symbols.get(name); }
	public lookup(name: string): SymbolInfo | undefined { return this.#symbols.get(name) ?? this.parent?.lookup(name); }
	public values(): readonly SymbolInfo[] { return [...this.#symbols.values()]; }
}

export class SymbolFactory {
	readonly #ids = new IdGenerator();
	public create(name: string, kind: SymbolKind, typeId: TypeId, span: SourceSpan, options: { readonly declaration?: AstNode | Declaration; readonly mutable?: boolean; readonly public?: boolean; readonly typeOnly?: boolean; readonly constant?: boolean } = {}): SymbolInfo {
		return { id: this.#ids.next(), name, kind, typeId, span, mutable: options.mutable ?? false, public: options.public ?? false, typeOnly: options.typeOnly ?? false, constant: options.constant ?? false, ...(options.declaration === undefined ? {} : { declaration: options.declaration }) };
	}
}
