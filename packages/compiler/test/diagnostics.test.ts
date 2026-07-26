import assert from 'node:assert/strict';
import test from 'node:test';
import { DIAGNOSTIC_SCHEMA_VERSION, DIAGNOSTIC_SOURCE, diagnosticCategory, diagnosticsToDocument, explainDiagnosticCode, isDiagnosticCode, qualifyDiagnosticCode } from '../src/public-api.js';
import type { Diagnostic, SourceFile } from '../src/public-api.js';

const primary: SourceFile = { id: 1, path: 'src/main.virune', text: 'fn main() -> String {\n\treturn 1\n}\n' };
const related: SourceFile = { id: 2, path: 'src/types.virune', text: 'type Name = String\n' };

const span = {
	fileId: primary.id,
	start: { offset: 23, line: 2, column: 9 },
	end: { offset: 24, line: 2, column: 10 },
};

test('stable diagnostic codes use the virune namespace and documented ranges', () => {
	assert.equal(isDiagnosticCode('L2043'), true);
	assert.equal(isDiagnosticCode('LTEST'), false);
	assert.equal(diagnosticCategory('L0002'), 'syntax');
	assert.equal(diagnosticCategory('L2043'), 'type-system');
	assert.equal(diagnosticCategory('L4201'), 'module');
	assert.equal(diagnosticCategory('L9001'), 'internal');
	assert.equal(qualifyDiagnosticCode('L2043'), 'virune/L2043');
	assert.match(explainDiagnosticCode('L2043') ?? '', /incompatible type/u);
});

test('structured diagnostics normalize related locations, help, fix IDs, and causes', () => {
	const diagnostic: Diagnostic = {
		code: 'L2043',
		severity: 'error',
		message: 'Expected String but received Int',
		span,
		related: [{
			message: 'The return type is declared here',
			span: {
				fileId: related.id,
				start: { offset: 12, line: 1, column: 13 },
				end: { offset: 18, line: 1, column: 19 },
			},
		}],
		help: 'Return a String or change the declared return type.',
		fixes: [{ id: 'change-return-value', title: 'Return a String', kind: 'replace', text: '"1"' }],
		cause: { kind: 'internal', name: 'TypeMismatch', message: 'Types were not assignable.' },
	};
	const document = diagnosticsToDocument([diagnostic], new Map([[primary.id, primary], [related.id, related]]));
	assert.equal(document.schemaVersion, DIAGNOSTIC_SCHEMA_VERSION);
	assert.equal(document.diagnostics.length, 1);
	assert.deepEqual(document.diagnostics[0], {
		source: DIAGNOSTIC_SOURCE,
		code: 'L2043',
		qualifiedCode: 'virune/L2043',
		category: 'type-system',
		severity: 'error',
		message: 'Expected String but received Int',
		file: 'src/main.virune',
		range: { start: { line: 2, column: 9 }, end: { line: 2, column: 10 } },
		related: [{
			message: 'The return type is declared here',
			file: 'src/types.virune',
			range: { start: { line: 1, column: 13 }, end: { line: 1, column: 19 } },
		}],
		help: 'Return a String or change the declared return type.',
		fixIds: ['change-return-value'],
		cause: { kind: 'internal', name: 'TypeMismatch', message: 'Types were not assignable.' },
	});
});

test('fixes without explicit IDs receive deterministic qualified IDs', () => {
	const diagnostic: Diagnostic = {
		code: 'L2043',
		severity: 'hint',
		message: 'A fix is available',
		span,
		fixes: [{ title: 'Apply fix', kind: 'replace', text: '"1"' }],
	};
	const document = diagnosticsToDocument([diagnostic], new Map([[primary.id, primary]]));
	assert.deepEqual(document.diagnostics[0]?.fixIds, ['virune/L2043/fix-1']);
});
