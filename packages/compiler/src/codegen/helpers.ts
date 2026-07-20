import type * as A from '../ast/nodes.js';

const jsReserved = new Set(['await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do', 'else', 'export', 'extends', 'false', 'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof', 'let', 'new', 'null', 'return', 'static', 'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield']);

export function safeName(name: string): string { return jsReserved.has(name) ? `$v_${name}` : name; }

export function collectBuiltinNamespaces(module: A.ModuleNode): ReadonlySet<string> {
	const namespaces = new Set<string>();
	const visit = (value: unknown): void => {
		if (value === null || typeof value !== 'object') return;
		if (Array.isArray(value)) { for (const item of value) visit(item); return; }
		const record = value as Record<string, unknown>;
		if (record.kind === 'FieldExpression') {
			const target = record.target as Record<string, unknown> | undefined;
			if (target?.kind === 'IdentifierExpression' && typeof target.name === 'string') namespaces.add(target.name);
		}
		for (const [key, item] of Object.entries(record)) {
			if (key === 'span' || key === 'inferredTypeId' || key === 'symbolId' || key === 'resolvedTypeId') continue;
			visit(item);
		}
	};
	visit(module);
	return namespaces;
}

export function escapeTemplate(value: string): string { return value.replaceAll('\\', '\\\\').replaceAll('`', '\\`').replaceAll('${', '\\${'); }
export function panicEmitter(message: string): never { throw new Error(message); }
