import { GenMapping, addMapping, setSourceContent, toEncodedMap } from '@jridgewell/gen-mapping';
import type { SourceFile, SourceSpan } from '../source.js';
import type { EmitResult } from './emitter.js';

export class SourceWriter {
	readonly #parts: string[] = [];
	readonly #map: GenMapping;
	#line = 1;
	#column = 0;
	#indent = 0;
	#lineStart = true;

	public constructor(readonly source: SourceFile, outputFile: string, readonly sourcePath: string, sourcesContent: boolean) {
		this.#map = new GenMapping({ file: outputFile.split(/[\\/]/u).at(-1) ?? outputFile });
		if (sourcesContent) setSourceContent(this.#map, sourcePath, source.text);
	}

	public mark(span: SourceSpan, name?: string): void {
		const mapping = { generated: { line: this.#line, column: this.#column }, source: this.sourcePath, original: { line: span.start.line, column: Math.max(0, span.start.column - 1) } };
		if (name === undefined) addMapping(this.#map, mapping);
		else addMapping(this.#map, { ...mapping, name });
	}

	public write(text: string): void {
		if (text.length === 0) return;
		if (this.#lineStart) {
			const indent = '\t'.repeat(this.#indent);
			this.#parts.push(indent);
			this.#column += indent.length;
			this.#lineStart = false;
		}
		this.#parts.push(text);
		for (const character of text) {
			if (character === '\n') { this.#line++; this.#column = 0; this.#lineStart = true; }
			else this.#column++;
		}
	}

	public line(text = ''): void {
		if (text.length > 0) this.write(text);
		this.#parts.push('\n');
		this.#line++;
		this.#column = 0;
		this.#lineStart = true;
	}

	public indent(action: () => void): void { this.#indent++; action(); this.#indent--; }
	public result(): EmitResult { return { code: this.#parts.join(''), map: JSON.stringify(toEncodedMap(this.#map)) }; }
}
