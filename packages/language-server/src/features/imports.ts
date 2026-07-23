import type { BuiltModule } from '@virune/compiler/experimental';
import { CodeActionKind, TextEdit, type CodeAction } from 'vscode-languageserver/node';
import { filePathToUri, offsetToPosition } from '../analysis/position.js';

export function organizeImportsAction(module: BuiltModule): CodeAction | undefined {
	if (module.ast === undefined || module.ast.imports.length < 2) return undefined;
	const source = module.source;
	const imports = module.ast.imports.map(declaration => {
		const start = lineStart(source.text, Math.max(0, declaration.span.start.line - 1));
		const end = lineStart(source.text, declaration.span.end.line);
		return {
			start,
			end: end <= start ? lineEndIncludingNewline(source.text, start) : end,
			text: source.text.slice(start, end <= start ? lineEndIncludingNewline(source.text, start) : end),
			source: declaration.source,
			typeOnly: declaration.typeOnly,
			public: declaration.public,
		};
	});
	const start = Math.min(...imports.map(item => item.start));
	const end = Math.max(...imports.map(item => item.end));
	const replacement = imports
		.sort((left, right) => Number(left.public) - Number(right.public)
			|| Number(left.typeOnly) - Number(right.typeOnly)
			|| left.source.localeCompare(right.source)
			|| left.text.localeCompare(right.text))
		.map(item => item.text.trimEnd())
		.join('\n') + '\n';
	if (source.text.slice(start, end) === replacement) return undefined;
	return {
		title: 'Organize Virune imports',
		kind: CodeActionKind.SourceOrganizeImports,
		edit: {
			changes: {
				[filePathToUri(source.path)]: [TextEdit.replace({ start: offsetToPosition(source, start), end: offsetToPosition(source, end) }, replacement)],
			},
		},
		isPreferred: true,
	};
}

function lineStart(text: string, line: number): number {
	let offset = 0;
	for (let index = 0; index < line; index++) {
		const next = text.indexOf('\n', offset);
		if (next < 0) return text.length;
		offset = next + 1;
	}
	return offset;
}

function lineEndIncludingNewline(text: string, offset: number): number {
	const next = text.indexOf('\n', offset);
	return next < 0 ? text.length : next + 1;
}
