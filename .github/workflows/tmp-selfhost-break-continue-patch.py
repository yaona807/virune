from pathlib import Path

def required_replace(value: str, old: str, new: str, label: str, count: int = 1) -> str:
    actual = value.count(old)
    if actual < count:
        raise RuntimeError(f'{label}: expected at least {count} occurrence(s), found {actual}')
    return value.replace(old, new, count)

model_path = Path('selfhost/mvp/src/model.virune')
model = model_path.read_text()
model = required_replace(
    model,
    '\tIfValue(Int, List<Int>, List<Int>, MvpSpan)\n\tReturnValue(Int, MvpSpan)',
    '\tIfValue(Int, List<Int>, List<Int>, MvpSpan)\n\tBreakValue(MvpSpan)\n\tContinueValue(MvpSpan)\n\tReturnValue(Int, MvpSpan)',
    'MvpStatement variants',
)
model = required_replace(
    model,
    '\tHirIf(Int, List<Int>, List<Int>, MvpSpan)\n\tHirReturn(Int, MvpSpan)',
    '\tHirIf(Int, List<Int>, List<Int>, MvpSpan)\n\tHirBreak(MvpSpan)\n\tHirContinue(MvpSpan)\n\tHirReturn(Int, MvpSpan)',
    'MvpHirStatement variants',
)
model_path.write_text(model)

parser_path = Path('selfhost/mvp/src/parser.virune')
parser = parser_path.read_text()
parser = required_replace(
    parser,
    '\t\tIfValue(_, _, _, valueSpan) => valueSpan\n\t\tReturnValue(_, valueSpan) => valueSpan',
    '\t\tIfValue(_, _, _, valueSpan) => valueSpan\n\t\tBreakValue(valueSpan) => valueSpan\n\t\tContinueValue(valueSpan) => valueSpan\n\t\tReturnValue(_, valueSpan) => valueSpan',
    'parser statementSpan variants',
)
control_statements = '''\tif start.text == "break" {
\t\treturn Ok(addStatement(
\t\t\tconsumeLineEnd(advance(cursor))?,
\t\t\tstatements,
\t\t\texpressions,
\t\t\tMvpStatement.BreakValue(start.span),
\t\t))
\t}
\tif start.text == "continue" {
\t\treturn Ok(addStatement(
\t\t\tconsumeLineEnd(advance(cursor))?,
\t\t\tstatements,
\t\t\texpressions,
\t\t\tMvpStatement.ContinueValue(start.span),
\t\t))
\t}
'''
parser = required_replace(
    parser,
    '\tif start.text == "if" {',
    control_statements + '\tif start.text == "if" {',
    'parser control statement insertion',
)
parser = required_replace(
    parser,
    'MVP supports only let, assignment, if, while, for, and return statements',
    'MVP supports only let, assignment, if, while, for, break, continue, and return statements',
    'parser supported statement diagnostic',
)
parser_path.write_text(parser)

checker_path = Path('selfhost/mvp/src/checker.virune')
checker = checker_path.read_text()
checker = required_replace(
    checker,
    '\treturnType: MvpType\n\tsourceExpressions: List<MvpExpression>',
    '\treturnType: MvpType\n\tloopDepth: Int\n\tsourceExpressions: List<MvpExpression>',
    'CheckContext loopDepth field',
)
for indentation in ('\t\t', '\t\t\t', '\t\t\t\t', '\t\t\t\t\t'):
    old = indentation + 'returnType: context.returnType,\n' + indentation + 'sourceExpressions:'
    new = indentation + 'returnType: context.returnType,\n' + indentation + 'loopDepth: context.loopDepth,\n' + indentation + 'sourceExpressions:'
    checker = checker.replace(old, new)
checker = required_replace(
    checker,
    '\t\t\treturnType: function.returnType,\n\t\t\tsourceExpressions:',
    '\t\t\treturnType: function.returnType,\n\t\t\tloopDepth: 0,\n\t\t\tsourceExpressions:',
    'function root loopDepth',
)

for_start = checker.index('fn checkFor(')
loop_context_start = checker.index('\tlet loopContext = CheckContext {', for_start)
loop_context_end = checker.index('\n\t}', loop_context_start)
loop_context = checker[loop_context_start:loop_context_end]
if '\t\tloopDepth: context.loopDepth,' not in loop_context:
    raise RuntimeError('for loop context did not receive loopDepth propagation')
loop_context = loop_context.replace(
    '\t\tloopDepth: context.loopDepth,',
    '\t\tloopDepth: context.loopDepth + 1,',
    1,
)
checker = checker[:loop_context_start] + loop_context + checker[loop_context_end:]

checker = required_replace(
    checker,
    '\tlet checkedBody = checkBlock(bodyStatementIds, context, statements, checkedCondition.expressions)?',
    '''\tlet loopContext = CheckContext {
\t\tsignatures: context.signatures,
\t\tbindings: context.bindings,
\t\treturnType: context.returnType,
\t\tloopDepth: context.loopDepth + 1,
\t\tsourceExpressions: context.sourceExpressions,
\t\tsourceStatements: context.sourceStatements,
\t}
\tlet checkedBody = checkBlock(bodyStatementIds, loopContext, statements, checkedCondition.expressions)?''',
    'while loop context',
)

loop_checks = '''fn checkBreak(statementSpan: MvpSpan, context: CheckContext, statements: List<MvpHirStatement>, expressions: List<MvpHirExpression>) -> Result<CheckedStatement, MvpDiagnostic> {
\tif context.loopDepth == 0 {
\t\treturn Err(errorDiagnostic("L2095", "break can be used only inside a loop", statementSpan))
\t}
\treturn Ok(addHirStatement(
\t\tstatements,
\t\texpressions,
\t\tcontext.bindings,
\t\tMvpHirStatement.HirBreak(statementSpan),
\t))
}

fn checkContinue(statementSpan: MvpSpan, context: CheckContext, statements: List<MvpHirStatement>, expressions: List<MvpHirExpression>) -> Result<CheckedStatement, MvpDiagnostic> {
\tif context.loopDepth == 0 {
\t\treturn Err(errorDiagnostic("L2096", "continue can be used only inside a loop", statementSpan))
\t}
\treturn Ok(addHirStatement(
\t\tstatements,
\t\texpressions,
\t\tcontext.bindings,
\t\tMvpHirStatement.HirContinue(statementSpan),
\t))
}

'''
checker = required_replace(
    checker,
    'fn checkStatement(statementId: Int, context: CheckContext, statements: List<MvpHirStatement>, expressions: List<MvpHirExpression>) -> Result<CheckedStatement, MvpDiagnostic> {',
    loop_checks + 'fn checkStatement(statementId: Int, context: CheckContext, statements: List<MvpHirStatement>, expressions: List<MvpHirExpression>) -> Result<CheckedStatement, MvpDiagnostic> {',
    'checker loop control functions',
)
checker = required_replace(
    checker,
    '\t\tIfValue(conditionId, consequentStatementIds, alternateStatementIds, valueSpan) => checkIf(conditionId, consequentStatementIds, alternateStatementIds, valueSpan, context, statements, expressions)\n\t\tReturnValue(expressionId, valueSpan) => checkReturn(expressionId, valueSpan, context, statements, expressions)',
    '\t\tIfValue(conditionId, consequentStatementIds, alternateStatementIds, valueSpan) => checkIf(conditionId, consequentStatementIds, alternateStatementIds, valueSpan, context, statements, expressions)\n\t\tBreakValue(valueSpan) => checkBreak(valueSpan, context, statements, expressions)\n\t\tContinueValue(valueSpan) => checkContinue(valueSpan, context, statements, expressions)\n\t\tReturnValue(expressionId, valueSpan) => checkReturn(expressionId, valueSpan, context, statements, expressions)',
    'checker statement dispatch',
)
if checker.count('CheckContext {') != checker.count('loopDepth:'):
    raise RuntimeError(
        f'CheckContext construction mismatch: contexts={checker.count("CheckContext {")}, loopDepth={checker.count("loopDepth:")}'
    )
checker_path.write_text(checker)

emitter_path = Path('selfhost/mvp/src/emitter.virune')
emitter = emitter_path.read_text()
emitter = required_replace(
    emitter,
    '\t\tHirIf(conditionExpressionId, consequentStatementIds, alternateStatementIds, _) => prefix + "if (" + emitExpression(conditionExpressionId, expressions) + ") {\\\\n" + emitStatements(consequentStatementIds, statements, expressions, depth + 1) + prefix + "}" + (if List.isEmpty(alternateStatementIds) then "\\\\n" else " else {\\\\n" + emitStatements(alternateStatementIds, statements, expressions, depth + 1) + prefix + "}\\\\n")\n\t\tHirReturn(expressionId, _) => prefix + "return " + emitExpression(expressionId, expressions) + ";\\\\n"',
    '\t\tHirIf(conditionExpressionId, consequentStatementIds, alternateStatementIds, _) => prefix + "if (" + emitExpression(conditionExpressionId, expressions) + ") {\\\\n" + emitStatements(consequentStatementIds, statements, expressions, depth + 1) + prefix + "}" + (if List.isEmpty(alternateStatementIds) then "\\\\n" else " else {\\\\n" + emitStatements(alternateStatementIds, statements, expressions, depth + 1) + prefix + "}\\\\n")\n\t\tHirBreak(_) => prefix + "break;\\\\n"\n\t\tHirContinue(_) => prefix + "continue;\\\\n"\n\t\tHirReturn(expressionId, _) => prefix + "return " + emitExpression(expressionId, expressions) + ";\\\\n"',
    'emitter loop control statements',
)
emitter_path.write_text(emitter)

Path('packages/compiler/test/selfhost-break-continue.test.ts').write_text('''import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildProject } from '../src/project/project.js';
import {
\tcreateSelfhostMvpKernel,
\ttype SelfhostMvpModule,
} from '../src/selfhost/mvp-adapter.js';
import { executeKernelOutputWithNode } from '../src/selfhost/node-executor.js';
import type { KernelInputV1 } from '../src/selfhost/contract.js';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const mvpRoot = join(repositoryRoot, 'selfhost', 'mvp');
const temporaryRoot = join(repositoryRoot, '.test-tmp');

const input = (text: string): KernelInputV1 => ({
\tcontractVersion: '1',
\tlanguageVersion: '1.0',
\tplatform: 'node',
\tentryPath: 'src/main.virune',
\tsources: [{ path: 'src/main.virune', text }],
\tinteropManifest: { version: '1', modules: [] },
\temit: { target: 'es2022', sourceMap: false, sourcesContent: true },
});

const runtimeSource = [
\t'pub fn main() -> Int {',
\t'\\tlet mut sum = 0',
\t'\\tlet mut index = 0',
\t'\\twhile index < 10 {',
\t'\\t\\tindex = index + 1',
\t'\\t\\tif index == 2 {',
\t'\\t\\t\\tcontinue',
\t'\\t\\t}',
\t'\\t\\tif index == 6 {',
\t'\\t\\t\\tbreak',
\t'\\t\\t}',
\t'\\t\\tsum = sum + index',
\t'\\t}',
\t'\\tfor value in [1, 2, 3, 4] {',
\t'\\t\\tif value == 2 {',
\t'\\t\\t\\tcontinue',
\t'\\t\\t}',
\t'\\t\\tif value == 4 {',
\t'\\t\\t\\tbreak',
\t'\\t\\t}',
\t'\\t\\tsum = sum + value',
\t'\\t}',
\t'\\treturn sum',
\t'}',
\t'',
].join('\\n');

const breakOutsideLoop = [
\t'pub fn main() -> Int {',
\t'\\tbreak',
\t'\\treturn 0',
\t'}',
\t'',
].join('\\n');

const continueOutsideLoop = [
\t'pub fn main() -> Int {',
\t'\\tcontinue',
\t'\\treturn 0',
\t'}',
\t'',
].join('\\n');

test('break and continue execute in while and for loops and reject loop-external use', async () => {
\tconst loaded = await loadMvpModule();
\ttry {
\t\tconst request = input(runtimeSource);
\t\tconst output = await createSelfhostMvpKernel(loaded.module).compile(request);
\t\tassert.equal(output.accepted, true, JSON.stringify(output.diagnostics, null, 2));
\t\tassert.deepEqual(output.diagnostics, []);
\t\tconst emittedCode = output.emittedModules.map(module => module.code).join('\\n');
\t\tassert.match(emittedCode, /break;/);
\t\tassert.match(emittedCode, /continue;/);
\t\tconst runtime = await executeKernelOutputWithNode(request, output);
\t\tassert.equal(runtime.returnValue, 17);
\t\tassert.equal(runtime.panic, null);

\t\tconst invalidBreak = await createSelfhostMvpKernel(loaded.module).compile(input(breakOutsideLoop));
\t\tassert.equal(invalidBreak.accepted, false);
\t\tassert.equal(invalidBreak.diagnostics[0]?.code, 'L2095');
\t\tassert.equal(invalidBreak.diagnostics[0]?.message, 'break can be used only inside a loop');

\t\tconst invalidContinue = await createSelfhostMvpKernel(loaded.module).compile(input(continueOutsideLoop));
\t\tassert.equal(invalidContinue.accepted, false);
\t\tassert.equal(invalidContinue.diagnostics[0]?.code, 'L2096');
\t\tassert.equal(invalidContinue.diagnostics[0]?.message, 'continue can be used only inside a loop');
\t} finally {
\t\tawait rm(loaded.root, { recursive: true, force: true });
\t}
});

async function loadMvpModule(): Promise<{ readonly root: string; readonly module: SelfhostMvpModule }> {
\tconst result = await buildProject(mvpRoot, { write: false });
\tconst errors = result.diagnostics.filter(item => item.severity === 'error');
\tassert.deepEqual(errors.map(item => `${item.code}:${item.message}`), []);
\tawait mkdir(temporaryRoot, { recursive: true });
\tconst root = await mkdtemp(join(temporaryRoot, 'selfhost-break-continue-'));
\tconst configuredOutDir = resolve(mvpRoot, 'dist');
\tconst outputPaths: string[] = [];
\tfor (const built of result.modules) {
\t\tif (built.output === undefined || built.outputPath === undefined) continue;
\t\tconst outputPath = join(root, relative(configuredOutDir, built.outputPath));
\t\tawait mkdir(dirname(outputPath), { recursive: true });
\t\tawait writeFile(outputPath, built.output.code);
\t\toutputPaths.push(outputPath);
\t}
\tfor (const outputPath of outputPaths.sort()) {
\t\tawait execFileAsync(process.execPath, ['--check', outputPath]);
\t}
\tconst moduleUrl = `${pathToFileURL(join(root, 'main.js')).href}?test=${Date.now()}`;
\treturn { root, module: await import(moduleUrl) as SelfhostMvpModule };
}
''')

Path('.github/workflows/tmp-selfhost-break-continue-pr.yml').unlink()
Path('.github/workflows/tmp-selfhost-break-continue-patch.py').unlink()
