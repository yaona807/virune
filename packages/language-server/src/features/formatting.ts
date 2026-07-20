import { formatSource } from '@virune/formatter';
import type { SourceFile } from '@virune/compiler/experimental';
import { TextEdit, type TextEdit as TextEditValue } from 'vscode-languageserver/node';
import { fullDocumentRange } from '../analysis/position.js';

export function formattingEdits(source: SourceFile): readonly TextEditValue[] {
	const result = formatSource(source.text);
	if (result.errors.length > 0 || !result.changed) return [];
	return [TextEdit.replace(fullDocumentRange(source), result.text)];
}
