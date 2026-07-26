export const DIAGNOSTIC_SOURCE = 'virune' as const;
export const DIAGNOSTIC_SCHEMA_VERSION = 1 as const;

export type DiagnosticCode = `L${string}`;
export type DiagnosticCategory =
	| 'syntax'
	| 'binding'
	| 'type-system'
	| 'control-flow'
	| 'module'
	| 'entry-point'
	| 'internal';

interface DiagnosticCodeRange {
	readonly first: number;
	readonly last: number;
	readonly category: DiagnosticCategory;
	readonly description: string;
}

export const DIAGNOSTIC_CODE_RANGES: readonly DiagnosticCodeRange[] = [
	{ first: 0, last: 999, category: 'syntax', description: 'Lexing, parsing, syntax, and source documentation diagnostics.' },
	{ first: 1000, last: 1999, category: 'binding', description: 'Name binding, declarations, symbols, and visibility diagnostics.' },
	{ first: 2000, last: 2999, category: 'type-system', description: 'Type checking, effects, calls, and value compatibility diagnostics.' },
	{ first: 3000, last: 3999, category: 'control-flow', description: 'Control-flow, exhaustiveness, ownership, and reachability diagnostics.' },
	{ first: 4000, last: 4999, category: 'module', description: 'Project, module graph, configuration, and JavaScript interop diagnostics.' },
	{ first: 5000, last: 5999, category: 'entry-point', description: 'CLI entry-point and executable-program diagnostics.' },
	{ first: 9000, last: 9999, category: 'internal', description: 'Unknown and internal compiler or tool failures.' },
] as const;

const SPECIFIC_EXPLANATIONS: Readonly<Record<string, string>> = {
	L0001: 'The lexer found a character sequence that is not valid Virune syntax.',
	L0002: 'The parser could not match the source against the Virune grammar.',
	L2043: 'A value was used where an incompatible type was required. Virune performs no implicit numeric or string conversions.',
	L3004: 'A match expression omitted at least one enum, Option, or Result variant.',
	L4002: 'Virune modules must form an acyclic dependency graph.',
	L5000: 'The CLI or compiler API encountered an unexpected tool-level failure.',
	L5010: 'The configured entry module or emitted entry file could not be used.',
	L9001: 'The compiler could not construct its abstract syntax tree after parsing.',
};

export function isDiagnosticCode(value: string): value is DiagnosticCode {
	return /^L\d{4}$/u.test(value) && diagnosticCategory(value) !== undefined;
}

export function diagnosticCategory(code: string): DiagnosticCategory | undefined {
	if (!/^L\d{4}$/u.test(code)) return undefined;
	const number = Number.parseInt(code.slice(1), 10);
	return DIAGNOSTIC_CODE_RANGES.find(range => number >= range.first && number <= range.last)?.category;
}

export function diagnosticCategoryDescription(category: DiagnosticCategory): string {
	return DIAGNOSTIC_CODE_RANGES.find(range => range.category === category)?.description ?? 'Virune diagnostic.';
}

export function qualifyDiagnosticCode(code: string): `${typeof DIAGNOSTIC_SOURCE}/${string}` {
	return `${DIAGNOSTIC_SOURCE}/${code}`;
}

export function explainDiagnosticCode(code: string): string | undefined {
	const category = diagnosticCategory(code);
	if (category === undefined) return undefined;
	return SPECIFIC_EXPLANATIONS[code] ?? diagnosticCategoryDescription(category);
}
