from pathlib import Path
root = Path('.')

def replace_once(path, old, new):
    p = root / path
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{path}: expected one anchor, found {count}: {old[:80]!r}')
    p.write_text(text.replace(old, new, 1))

# 1. Stable v2 is deliberately External-only and async-only.
replace_once('packages/compiler/src/interop/types.ts', """interface NativeCallableBoundaryDescriptorV2 {
\treadonly version: 'virune-callable-shim/v2';
\treadonly parameters: readonly (NativeCallablePrimitiveKind | 'External')[];
\treadonly result: NativeCallablePrimitiveKind | 'External' | 'Never';
\treadonly async: boolean;
\treadonly effects: readonly string[];
\treadonly contextMode: 'root-argument';
}""", """interface NativeCallableBoundaryDescriptorV2 {
\treadonly version: 'virune-callable-shim/v2';
\treadonly parameters: readonly 'External'[];
\treadonly result: 'External' | 'Never';
\treadonly async: true;
\treadonly effects: readonly string[];
\treadonly contextMode: 'root-argument';
}""")
replace_once('packages/compiler/src/interop/types.ts', "| { readonly kind: 'contextual-callable'; readonly parameterCount: number; readonly async: boolean }", "| { readonly kind: 'contextual-callable'; readonly parameterCount: number; readonly async: true }")

# 2. Only last-position, async, fully-unannotated inline lambdas enter contextual inference.
replace_once('packages/compiler/src/checker/checker.ts', """\tprivate prepareForeignCallValue(expression: A.Expression, scope: Scope, allowContextual: boolean): PreparedInteropValue {
\t\tif (allowContextual && expression.kind === 'LambdaExpression' && expression.parameters.some(parameter => parameter.annotation === undefined)) {
\t\t\treturn { expression, argument: { kind: 'contextual-callable', parameterCount: expression.parameters.length, async: expression.async }, point: this.semanticPoint() };
\t\t}
\t\treturn this.prepareInteropValue(expression, scope);
\t}""", """\tprivate prepareForeignCallValue(expression: A.Expression, scope: Scope, allowContextual: boolean): PreparedInteropValue {
\t\tif (allowContextual && expression.kind === 'LambdaExpression' && expression.async && expression.parameters.length > 0 && expression.parameters.every(parameter => parameter.annotation === undefined)) {
\t\t\treturn { expression, argument: { kind: 'contextual-callable', parameterCount: expression.parameters.length, async: true }, point: this.semanticPoint() };
\t\t}
\t\treturn this.prepareInteropValue(expression, scope);
\t}""")

# 3. Preliminary contextual evidence accepts only concrete External object parameters.
replace_once('packages/compiler/src/checker/checker.ts', """\t\t\tconst parameters = this.validatedContextualCallableParameters(target.parameters, provider);
\t\t\tconst contextualResult = canonicalContextualCallableResult(target.result);
\t\t\tif (parameters === undefined || contextualResult?.kind !== 'deferred') return undefined;
\t\t\tresult.push(Object.freeze({ index: expectedIndex, target: Object.freeze({ parameters, result: contextualResult }) }));""", """\t\t\tconst parameters = target.parameters.every(parameter => typeof parameter !== 'string' && parameter.category === 'object' && this.isCurrentForeignSnapshot(parameter, provider, false))
\t\t\t\t? Object.freeze(target.parameters as ForeignTypeSnapshot[])
\t\t\t\t: undefined;
\t\t\tconst contextualResult = canonicalContextualCallableResult(target.result);
\t\t\tif (parameters === undefined || contextualResult?.kind !== 'deferred') return undefined;
\t\t\tresult.push(Object.freeze({ index: expectedIndex, target: Object.freeze({ parameters, result: contextualResult }) }));""")
replace_once('packages/compiler/src/checker/checker.ts', """\tprivate contextualCallableTypeId(value: InteropCallableArgumentResolution['target']['parameters'][number], provider: JsInteropProvider): TypeId | undefined {
\t\tif (typeof value !== 'string') return this.isCurrentForeignSnapshot(value, provider, false) ? this.arena.foreign(value) : undefined;
\t\treturn value === 'boolean' ? this.arena.bool
\t\t\t: value === 'string' ? this.arena.string
\t\t\t\t: value === 'number' ? this.arena.float
\t\t\t\t\t: value === 'bigint' ? this.arena.bigint
\t\t\t\t\t\t: value === 'undefined' ? this.arena.unit
\t\t\t\t\t\t\t: undefined;
\t}""", """\tprivate contextualCallableTypeId(value: InteropCallableArgumentResolution['target']['parameters'][number], provider: JsInteropProvider): TypeId | undefined {
\t\treturn typeof value !== 'string' && value.category === 'object' && this.isCurrentForeignSnapshot(value, provider, false)
\t\t\t? this.arena.foreign(value)
\t\t\t: undefined;
\t}""")

# 4. Preserve named primitive callbacks as exact v1; v2 exists only for async inline External lambdas.
p = root / 'packages/compiler/src/checker/checker.ts'
text = p.read_text()
a = text.index('\tprivate nativeCallableProjection(')
b = text.index('\n\tprivate validateContextualCallableArgumentEvidence(', a)
replacement = """\tprivate nativeCallableProjection(typeId: TypeId, expression: A.Expression): { readonly boundary: NativeCallableBoundaryDescriptor; readonly callable: import('../interop/types.js').NativeCallableTypeTemplate } | undefined {
\t\tconst type = this.arena.get(typeId);
\t\tif (type.kind !== 'function' || type.typeParameters.length !== 0 || type.effects.some(effect => effect === '*' || !this.#effects.has(effect))) return undefined;
\t\tconst effects = Object.freeze([...new Set(type.effects)].sort(compareText));
\t\tif (expression.kind === 'IdentifierExpression') {
\t\t\tif (expression.symbolId === undefined) return undefined;
\t\t\tconst symbol = this.#symbols.get(expression.symbolId);
\t\t\tconst declaration = symbol?.declaration;
\t\t\tif (symbol?.kind !== 'function' || declaration?.kind !== 'FunctionDeclaration') return undefined;
\t\t\tconst functionDeclaration = declaration as A.FunctionDeclaration;
\t\t\tif (functionDeclaration.typeParameters.length !== 0 || functionDeclaration.attributes.some(attribute => attribute.name === 'jsExport')) return undefined;
\t\t\tconst parameters: NativeCallablePrimitiveKind[] = [];
\t\t\tfor (const parameter of type.parameters) {
\t\t\t\tconst primitive = this.nativeCallablePrimitive(parameter);
\t\t\t\tif (primitive === undefined) return undefined;
\t\t\t\tparameters.push(primitive);
\t\t\t}
\t\t\tconst result = this.nativeCallablePrimitive(type.result);
\t\t\tif (result === undefined) return undefined;
\t\t\tconst frozenParameters = Object.freeze(parameters);
\t\t\treturn Object.freeze({
\t\t\t\tcallable: Object.freeze({ parameters: frozenParameters, result, async: type.async }),
\t\t\t\tboundary: Object.freeze({ version: 'virune-callable-shim/v1', parameters: frozenParameters, result, async: type.async, effects, contextMode: 'root-argument' }),
\t\t\t});
\t\t}
\t\tif (expression.kind !== 'LambdaExpression' || !expression.async || type.parameters.length === 0) return undefined;
\t\tconst parameters: { readonly kind: 'foreign'; readonly type: import('../interop/types.js').ForeignTypeRef }[] = [];
\t\tfor (const parameter of type.parameters) {
\t\t\tconst foreign = this.currentExternalObjectRef(parameter);
\t\t\tif (foreign === undefined) return undefined;
\t\t\tparameters.push({ kind: 'foreign', type: foreign });
\t\t}
\t\tconst resultType = this.arena.get(type.result);
\t\tconst result = resultType.kind === 'primitive' && resultType.name === 'Never'
\t\t\t? 'Never' as const
\t\t\t: this.currentExternalObjectRef(type.result);
\t\tif (result === undefined) return undefined;
\t\treturn Object.freeze({
\t\t\tcallable: Object.freeze({
\t\t\t\tparameters: Object.freeze(parameters),
\t\t\t\tresult: result === 'Never' ? result : { kind: 'foreign', type: result },
\t\t\t\tasync: true,
\t\t\t}),
\t\t\tboundary: Object.freeze({
\t\t\t\tversion: 'virune-callable-shim/v2',
\t\t\t\tparameters: Object.freeze(parameters.map(() => 'External' as const)),
\t\t\t\tresult: result === 'Never' ? 'Never' : 'External',
\t\t\t\tasync: true,
\t\t\t\teffects,
\t\t\t\tcontextMode: 'root-argument',
\t\t\t}),
\t\t});
\t}

\tprivate currentExternalObjectRef(typeId: TypeId): import('../interop/types.js').ForeignTypeRef | undefined {
\t\tconst type = this.arena.get(typeId);
\t\tif (type.kind !== 'foreign' || type.snapshot.category !== 'object') return undefined;
\t\tconst provider = this.currentInteropProvider(type.snapshot);
\t\treturn provider !== undefined && this.isCurrentForeignSnapshot(type.snapshot, provider, false) ? type.ref : undefined;
\t}
"""
p.write_text(text[:a] + replacement + text[b:])

# 5. v2 final evidence is External-only; v1 retains existing primitive contextual matching.
replace_once('packages/compiler/src/checker/checker.ts', """\tprivate callableBoundaryMatchesContext(
\t\tboundary: NativeCallableBoundaryDescriptor,
\t\tparameters: readonly InteropCallableArgumentResolution['target']['parameters'][number][],
\t\tresult: ContextualCallableResult,
\t): boolean {
\t\tif (boundary.parameters.length !== parameters.length) return false;
\t\tif (boundary.parameters.some((parameter, index) => {
\t\t\tconst target = parameters[index]!;
\t\t\treturn parameter === 'External' ? typeof target === 'string' : typeof target !== 'string' || !callableParameterMatchesContext(parameter, target);
\t\t})) return false;
\t\tif (result.kind === 'deferred') return false;
\t\tif (boundary.result === 'External' || boundary.result === 'Never') return result.kind === 'external';
\t\tif (result.kind === 'external') return false;
\t\tif (result.kind === 'void') return !boundary.async && boundary.result === 'Unit';
\t\tif (boundary.async !== (result.kind === 'promise')) return false;
\t\tif (boundary.result === 'Unit') return result.value === 'undefined' || result.kind === 'promise' && result.value === 'void';
\t\treturn callablePrimitiveExternalName(boundary.result) === result.value;
\t}""", """\tprivate callableBoundaryMatchesContext(
\t\tboundary: NativeCallableBoundaryDescriptor,
\t\tparameters: readonly InteropCallableArgumentResolution['target']['parameters'][number][],
\t\tresult: ContextualCallableResult,
\t): boolean {
\t\tif (boundary.parameters.length !== parameters.length || result.kind === 'deferred') return false;
\t\tif (boundary.version === 'virune-callable-shim/v2') {
\t\t\treturn boundary.async === true
\t\t\t\t&& boundary.parameters.every(parameter => parameter === 'External')
\t\t\t\t&& parameters.every(parameter => typeof parameter !== 'string')
\t\t\t\t&& result.kind === 'external';
\t\t}
\t\tif (parameters.some(parameter => typeof parameter !== 'string')) return false;
\t\tif (boundary.parameters.some((parameter, index) => !callableParameterMatchesContext(parameter, parameters[index] as ContextualCallablePrimitiveKind))) return false;
\t\tif (result.kind === 'external') return false;
\t\tif (result.kind === 'void') return !boundary.async && boundary.result === 'Unit';
\t\tif (boundary.async !== (result.kind === 'promise')) return false;
\t\tif (boundary.result === 'Unit') return result.value === 'undefined' || result.kind === 'promise' && result.value === 'void';
\t\treturn callablePrimitiveExternalName(boundary.result) === result.value;
\t}""")

# 6. Stable operation canonicalization accepts only the intentionally narrow v2 domain.
p = root / 'packages/compiler/src/interop/operation.ts'
text = p.read_text()
text = text.replace("const CALLABLE_BOUNDARY_VALUES = [...CALLABLE_PRIMITIVES, 'External'] as const;\nconst CALLABLE_BOUNDARY_RESULTS = [...CALLABLE_BOUNDARY_VALUES, 'Never'] as const;\n", "")
a = text.index('function canonicalCallableDescriptor(')
b = text.index('\nfunction canonicalForeignType(', a)
canonical = """function canonicalCallableDescriptor(descriptor: NativeCallableBoundaryDescriptor): NativeCallableBoundaryDescriptor {
\tif (descriptor.version !== 'virune-callable-shim/v1' && descriptor.version !== 'virune-callable-shim/v2') throw new Error('Unknown native callable boundary descriptor version');
\tif (!Array.isArray(descriptor.parameters)) throw new Error('Native callable boundary parameters must be an array');
\tif (typeof descriptor.async !== 'boolean') throw new Error('Native callable boundary async flag must be boolean');
\tif (descriptor.contextMode !== 'root-argument') throw new Error('Native callable boundary requires external-root invocation');
\tif (!Array.isArray(descriptor.effects)) throw new Error('Native callable boundary effects must be an array');
\tconst effects = descriptor.effects.map(effect => stableProviderText(effect, 'native callable effect'));
\tif (effects.includes('*')) throw new Error('Open effects cannot become stable native callable boundary evidence');
\tconst canonicalEffects = [...new Set(effects)].sort(compareText);
\tif (canonicalEffects.length !== effects.length || canonicalEffects.some((effect, index) => effect !== effects[index])) throw new Error('Native callable boundary effects must be unique and canonically ordered');
\tif (descriptor.version === 'virune-callable-shim/v1') {
\t\tconst parameters = descriptor.parameters.map(parameter => {
\t\t\tassertKnown(CALLABLE_PRIMITIVES, parameter, 'native callable primitive');
\t\t\treturn parameter;
\t\t});
\t\tassertKnown(CALLABLE_PRIMITIVES, descriptor.result, 'native callable result primitive');
\t\treturn Object.freeze({ version: 'virune-callable-shim/v1', parameters: Object.freeze(parameters), result: descriptor.result, async: descriptor.async, effects: Object.freeze(canonicalEffects), contextMode: 'root-argument' });
\t}
\tif (descriptor.async !== true || descriptor.parameters.some(parameter => parameter !== 'External') || (descriptor.result !== 'External' && descriptor.result !== 'Never')) {
\t\tthrow new Error('Native callable boundary v2 only supports async External callbacks');
\t}
\treturn Object.freeze({ version: 'virune-callable-shim/v2', parameters: Object.freeze(descriptor.parameters.map(() => 'External' as const)), result: descriptor.result, async: true, effects: Object.freeze(canonicalEffects), contextMode: 'root-argument' });
}
"""
p.write_text(text[:a] + canonical + text[b:])

# 7. Emitter keeps v1 path explicit and gives v2 only identity-preserving External forwarding.
p = root / 'packages/compiler/src/codegen/emitter.ts'
text = p.read_text()
a = text.index('\tprivate callableProjection(')
b = text.index('\n\tprivate callableFfiDescriptor(', a)
emitter = """\tprivate callableProjection(callable: string, descriptor: NativeCallableBoundaryDescriptor): string {
\t\tconst rawParameters = descriptor.parameters.map((_, index) => `$raw${index}`);
\t\tlet body: string;
\t\tif (descriptor.version === 'virune-callable-shim/v1') {
\t\t\tconst validated = descriptor.parameters.map((parameter, index) => `validateFfiValue(${rawParameters[index]}, ${this.callableFfiDescriptor(parameter)}, ${javascriptStringLiteral(`$[${index}]`)})`);
\t\t\tconst invocation = `$fn(${[...validated, 'rootTaskContext()'].join(', ')})`;
\t\t\tconst result = descriptor.async ? `await ${invocation}` : invocation;
\t\t\tbody = `return encodeFfiValue(${result}, ${this.callableFfiDescriptor(descriptor.result)});`;
\t\t} else {
\t\t\tconst invocation = `$fn(${[...rawParameters, 'rootTaskContext()'].join(', ')})`;
\t\t\tconst result = `await ${invocation}`;
\t\t\tbody = descriptor.result === 'Never'
\t\t\t\t? `${result}; throw new Error(\"Virune Never callback returned unexpectedly\");`
\t\t\t\t: `return ${result};`;
\t\t}
\t\tconst wrapper = `${descriptor.async ? 'async ' : ''}(${rawParameters.join(', ')}) => { try { ${body} } catch ($error) { throw $viruneExternalizeInteropError($error); } }`;
\t\tconst descriptorKey = JSON.stringify(descriptor);
\t\treturn `$viruneProjectCallable(${callable}, ${javascriptStringLiteral(descriptorKey)}, $fn => (${wrapper}))`;
\t}
"""
p.write_text(text[:a] + emitter + text[b:])

# 8. Extend focused tests with explicit scope controls without adding package-specific behavior.
p = root / 'packages/js-interop/test/contextual-external-callable.test.ts'
text = p.read_text()
text = text.replace("export declare function routeUnknown(handler: (context: unknown) => Promise<ExternalResponse>): void;", "export declare function routeUnknown(handler: (context: unknown) => Promise<ExternalResponse>): void;\nexport declare function routeMixed(handler: (context: ExternalContext, count: number) => Promise<ExternalResponse>): void;")
text += r'''

test('mixed primitive and External contextual parameters remain outside v2', async () => {
\tconst result = await compileCase(
\t\tdeclarations,
\t\t`import js { routeMixed } from "./library.js"\n\nfn main() -> Unit uses JavaScript {\n\tdiscard routeMixed(async fn(context, count) uses JavaScript => context.text("mixed"))\n\treturn Unit\n}\n`,
\t);
\tassert.notEqual(errors(result).length, 0);
\tassert.equal(result.semantic?.interop.callableProjections?.length ?? 0, 0);
});
'''
p.write_text(text)

print('narrowed')
