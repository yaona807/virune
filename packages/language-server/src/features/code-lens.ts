import type { BuiltModule } from '@virune/compiler/experimental';
import type { AnalysisSnapshot } from '../analysis/project-manager.js';
import type { CodeLens, Command, Location } from 'vscode-languageserver/node';
import { filePathToUri, nameRange } from '../analysis/position.js';
import type { EditorInformationSettings } from '../editor-information.js';

export function codeLenses(
	snapshot: AnalysisSnapshot,
	module: BuiltModule,
	settings: EditorInformationSettings,
): readonly CodeLens[] {
	if (module.ast === undefined || module.semantic === undefined) return [];
	const uri = filePathToUri(module.source.path);
	const result: CodeLens[] = [];
	for (const declaration of module.ast.declarations) {
		if (!('name' in declaration) || typeof declaration.name !== 'string' || !('symbolId' in declaration)) continue;
		if (settings.codeLens.visibility === 'public' && (!('public' in declaration) || declaration.public !== true)) continue;
		const symbolId = declaration.symbolId;
		if (typeof symbolId !== 'number') continue;
		const symbol = module.semantic.symbols.get(symbolId);
		if (symbol === undefined) continue;
		const hit = snapshot.index.symbolAt(uri, nameRange(module.source, declaration.span, declaration.name).start);
		if (hit === undefined) continue;
		const range = nameRange(module.source, declaration.span, declaration.name);
		if (settings.codeLens.references) {
			const locations = snapshot.index.locations(hit.symbol.key, false);
			result.push({ range, command: referenceCommand(`${locations.length} references`, uri, range.start, locations) });
		}
		if (settings.codeLens.callers && (symbol.kind === 'function' || symbol.kind === 'extern')) {
			const calls = snapshot.index.callsTo(hit.symbol.key);
			const callers = new Set(calls.map(call => call.containerKey).filter((value): value is string => value !== undefined));
			const locations = calls.map(call => ({ uri: call.uri, range: call.range }));
			result.push({ range, command: referenceCommand(`${callers.size} callers`, uri, range.start, locations) });
		}
	}
	return result;
}

function referenceCommand(title: string, uri: string, position: { readonly line: number; readonly character: number }, locations: readonly Location[]): Command {
	return {
		title,
		command: 'editor.action.showReferences',
		arguments: [uri, position, locations],
	};
}
