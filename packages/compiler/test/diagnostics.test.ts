import assert from 'node:assert/strict';
import test from 'node:test';
import { DIAGNOSTIC_SCHEMA_VERSION, DIAGNOSTIC_SOURCE, compileSource, diagnosticCategory, diagnosticsToDocument, explainDiagnosticCode, isDiagnosticCode, qualifyDiagnosticCode, renderDiagnostic } from '../src/public-api.js';
import { DiagnosticBag } from '../src/diagnostics/diagnostic.js';
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


test('high-frequency safety diagnostics provide actionable help without changing their stable identity', () => {
	const effectSource: SourceFile = {
		id: 3,
		path: 'effect.virune',
		text: 'fn writeMessage(message: String) -> Unit {\n\tConsole.print(message)\n\treturn Unit\n}\n',
	};
	const effect = compileSource(effectSource, { emit: false }).diagnostics.find(item => item.code === 'L2076');
	assert.ok(effect);
	assert.equal(effect.severity, 'error');
	assert.match(effect.help ?? '', /uses clause/u);
	assert.equal(effect.fixes, undefined);

	const mustUseSource: SourceFile = {
		id: 4,
		path: 'must-use.virune',
		text: 'fn loadValue() -> Result<Int, String> {\n\treturn Ok(1)\n}\n\nfn main() -> Unit {\n\tloadValue()\n\treturn Unit\n}\n',
	};
	const mustUse = compileSource(mustUseSource, { emit: false }).diagnostics.find(item => item.code === 'L2097');
	assert.ok(mustUse);
	assert.equal(mustUse.severity, 'error');
	assert.match(mustUse.help ?? '', /discard <expression>/u);
	assert.deepEqual(mustUse.fixes, [{
		id: 'discard-must-use-value',
		title: 'Discard this value explicitly',
		kind: 'insert',
		span: mustUse.span,
		text: 'discard ',
	}]);
	assert.match(renderDiagnostic(mustUse, mustUseSource), /help: .*discard <expression>/u);
	const document = diagnosticsToDocument([mustUse], new Map([[mustUseSource.id, mustUseSource]]));
	assert.equal(document.diagnostics[0]?.help, mustUse.help);
	assert.deepEqual(document.diagnostics[0]?.fixIds, ['discard-must-use-value']);

	const openEffectSource: SourceFile = {
		id: 5,
		path: 'open-effect.virune',
		text: 'record Action {\n\trun: fn() -> Unit uses *\n}\n',
	};
	const openEffect = compileSource(openEffectSource, { emit: false }).diagnostics.find(item => item.code === 'L2113');
	assert.ok(openEffect);
	assert.equal(openEffect.severity, 'error');
	assert.match(openEffect.help ?? '', /non-escaping/u);
	assert.equal(openEffect.fixes, undefined);
});

test('unsafe FFI, platform, and JavaScript interop diagnostics expose correction choices without speculative fixes', () => {
	const codes = ['L4006', 'L4007', 'L4008', 'L4009', 'L4010', 'L4011', 'L4204', 'L4212', 'L4213'] as const;
	const bag = new DiagnosticBag();
	for (const code of codes) bag.error(code, 'test diagnostic', span);
	assert.equal(bag.items.length, codes.length);
	for (const diagnostic of bag.items) {
		assert.ok(diagnostic.help?.length);
		assert.equal(diagnostic.fixes, undefined);
		assert.notEqual(explainDiagnosticCode(diagnostic.code), diagnosticCategoryDescriptionForTest(diagnostic.code));
	}
	assert.match(bag.items.find(item => item.code === 'L4007')?.help ?? '', /unsafe module/u);
	assert.match(bag.items.find(item => item.code === 'L4008')?.help ?? '', /src\/ffi\//u);
	assert.match(bag.items.find(item => item.code === 'L4010')?.help ?? '', /node platform/u);
	assert.match(bag.items.find(item => item.code === 'L4011')?.help ?? '', /browser platform/u);
	assert.match(bag.items.find(item => item.code === 'L4204')?.help ?? '', /Unknown.*unsafe extern js/u);
});

function diagnosticCategoryDescriptionForTest(code: string): string | undefined {
	const category = diagnosticCategory(code);
	if (category === undefined) return undefined;
	if (category === 'module') return 'Project, module graph, configuration, and JavaScript interop diagnostics.';
	return undefined;
}
