export type FileId = number;
export type NodeId = number;
export type SymbolId = number;
export type TypeId = number;

export interface SourceFile {
	readonly id: FileId;
	readonly path: string;
	readonly text: string;
}

export interface SourcePosition {
	readonly offset: number;
	readonly line: number;
	readonly column: number;
}

export interface SourceSpan {
	readonly fileId: FileId;
	readonly start: SourcePosition;
	readonly end: SourcePosition;
}

export const zeroSpan = (fileId: FileId): SourceSpan => ({
	fileId,
	start: { offset: 0, line: 1, column: 1 },
	end: { offset: 0, line: 1, column: 1 },
});

export class IdGenerator {
	#next = 1;
	public next(): number { return this.#next++; }
}
