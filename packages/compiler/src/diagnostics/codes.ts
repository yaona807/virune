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
	L2076: 'A call requires an effect that the enclosing function did not declare in its uses clause.',
	L2097: 'A must-use value was ignored instead of being consumed or explicitly discarded.',
	L2113: 'An open-effect uses * callback crossed a boundary where only non-escaping callbacks are permitted.',
	L3004: 'A match expression omitted at least one enum, Option, or Result variant.',
	L4002: 'Virune modules must form an acyclic dependency graph.',
	L4006: 'A Node.js extern was used from a project that is not targeting the node platform.',
	L4007: 'An unsafe extern must be declared inside an unsafe module.',
	L4008: 'An unsafe extern must be located under the project source ffi directory.',
	L4009: 'An unsafe module must be located under the project source ffi directory.',
	L4010: 'A Node-only built-in API was used from a project targeting another platform.',
	L4011: 'A browser-only built-in API was used from a project targeting another platform.',
	L4204: 'Virune could not prove a safe concrete JavaScript interop call or callback shape.',
	L4212: 'A JavaScript import resolved to TypeScript any and therefore lacks a safe concrete boundary shape.',
	L4213: 'A safe JavaScript boundary used a type that Virune cannot fully validate.',
	L5000: 'The CLI or compiler API encountered an unexpected tool-level failure.',
	L5010: 'The configured entry module or emitted entry file could not be used.',
	L9001: 'The compiler could not construct its abstract syntax tree after parsing.',
};

const ACTIONABLE_HELP: Readonly<Record<string, string>> = {
	L2076: 'Declare the required effect in the enclosing function uses clause, or move the call into a function that already declares that effect.',
	L2097: 'Use the value by binding, returning, awaiting, or handling it. If ignoring it is intentional, write discard <expression>.',
	L2113: 'uses * callbacks are non-escaping. Invoke the callback directly in the receiving scope; if it must escape, give it an explicit effect set instead of uses *.',
	L4006: 'Build this code for the node platform, or replace the Node.js dependency with an API available on the current platform.',
	L4007: 'Declare the containing module as unsafe module, and keep it under the project source ffi/ directory.',
	L4008: 'Move the unsafe module under the project source ffi/ directory (normally src/ffi/).',
	L4009: 'Move the unsafe module under the project source ffi/ directory (normally src/ffi/).',
	L4010: 'Build this code for the node platform, or replace the Node-only API with one available on the current platform.',
	L4011: 'Build this code for the browser platform, or replace the browser-only API with one available on the current platform.',
	L4204: 'Use a typed TypeScript interop adapter for a concrete supported shape. For genuinely dynamic data, cross as Unknown and validate it; use unsafe extern js only when a safe adapter cannot model the boundary.',
	L4212: 'Prefer a typed TypeScript adapter that exposes a concrete type. If the value is genuinely dynamic, expose Unknown and decode it; use unsafe extern js only when neither safe path can model the boundary.',
	L4213: 'Use a boundary shape that can be validated, or accept/return Unknown and decode/encode explicitly. Use unsafe extern js only when validation is intentionally unavailable.',
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

export function diagnosticHelp(code: string): string | undefined {
	return ACTIONABLE_HELP[code];
}
