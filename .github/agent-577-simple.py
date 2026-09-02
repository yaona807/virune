from pathlib import Path
root=Path('.')

def replace_once(path, old, new):
    p=root/path
    text=p.read_text()
    if text.count(old)!=1:
        raise RuntimeError(f'{path}: anchor count {text.count(old)} for {old[:80]!r}')
    p.write_text(text.replace(old,new,1))

checker=root/'packages/compiler/src/checker/checker.ts'
text=checker.read_text()
# finalization uses dedicated External inline projection only
old='const projection = this.nativeCallableProjection(typeId, argument);'
if text.count(old)!=1: raise RuntimeError(('final projection',text.count(old)))
text=text.replace(old,'const projection = this.externalInlineCallableProjection(typeId, argument);',1)
checker.write_text(text)

# ordinary values preserve current-main v1 implementation exactly
old="""\tprivate prepareInteropValue(expression: A.Expression, scope: Scope): PreparedInteropValue {
\t\tif (expression.kind === 'ContextualAggregateExpression') {
\t\t\tconst object = this.prepareContextualObject(expression, scope);
\t\t\treturn { expression, argument: { kind: 'contextual-object', object: object.usage }, object, point: this.semanticPoint() };
\t\t}
\t\tconst typeId = this.checkExpression(expression, scope);
\t\tconst projection = this.nativeCallableProjection(typeId, expression);
\t\tconst argument: InteropArgumentType = projection === undefined
\t\t\t? this.interopArgumentType(typeId, expression, expression.span)
\t\t\t: { kind: 'native-callable', callable: projection.callable };
\t\treturn { expression, argument, ...(projection === undefined ? {} : { boundary: projection.boundary }), point: this.semanticPoint() };
\t}"""
new="""\tprivate prepareInteropValue(expression: A.Expression, scope: Scope): PreparedInteropValue {
\t\tif (expression.kind === 'ContextualAggregateExpression') {
\t\t\tconst object = this.prepareContextualObject(expression, scope);
\t\t\treturn { expression, argument: { kind: 'contextual-object', object: object.usage }, object, point: this.semanticPoint() };
\t\t}
\t\tconst typeId = this.checkExpression(expression, scope);
\t\tconst boundary = this.nativeCallableBoundary(typeId, expression);
\t\tconst argument: InteropArgumentType = boundary === undefined
\t\t\t? this.interopArgumentType(typeId, expression, expression.span)
\t\t\t: { kind: 'native-callable', callable: { parameters: boundary.parameters, result: boundary.result, async: boundary.async } };
\t\treturn { expression, argument, ...(boundary === undefined ? {} : { boundary }), point: this.semanticPoint() };
\t}"""
replace_once(Path('packages/compiler/src/checker/checker.ts'),old,new)

# replace generalized native projection block with unchanged v1 + tiny contextual v2 helper
text=checker.read_text(); a=text.index('\tprivate nativeCallableProjection('); b=text.index('\n\tprivate validateContextualCallableArgumentEvidence(',a)
block="""\tprivate nativeCallableBoundary(typeId: TypeId, expression: A.Expression): NativeCallableBoundaryDescriptor | undefined {
\t\tconst type = this.arena.get(typeId);
\t\tif (type.kind !== 'function' || type.typeParameters.length !== 0 || type.effects.some(effect => effect === '*' || !this.#effects.has(effect))) return undefined;
\t\tif (expression.kind !== 'IdentifierExpression' || expression.symbolId === undefined) return undefined;
\t\tconst symbol = this.#symbols.get(expression.symbolId);
\t\tconst declaration = symbol?.declaration;
\t\tif (symbol?.kind !== 'function' || declaration?.kind !== 'FunctionDeclaration') return undefined;
\t\tconst functionDeclaration = declaration as A.FunctionDeclaration;
\t\tif (functionDeclaration.typeParameters.length !== 0 || functionDeclaration.attributes.some(attribute => attribute.name === 'jsExport')) return undefined;
\t\tconst parameters: NativeCallablePrimitiveKind[] = [];
\t\tfor (const parameter of type.parameters) {
\t\t\tconst primitive = this.nativeCallablePrimitive(parameter);
\t\t\tif (primitive === undefined) return undefined;
\t\t\tparameters.push(primitive);
\t\t}
\t\tconst result = this.nativeCallablePrimitive(type.result);
\t\tif (result === undefined) return undefined;
\t\treturn Object.freeze({
\t\t\tversion: 'virune-callable-shim/v1',
\t\t\tparameters: Object.freeze(parameters),
\t\t\tresult,
\t\t\tasync: type.async,
\t\t\teffects: Object.freeze([...new Set(type.effects)].sort(compareText)),
\t\t\tcontextMode: 'root-argument',
\t\t});
\t}

\tprivate nativeCallablePrimitive(typeId: TypeId): NativeCallablePrimitiveKind | undefined {
\t\tconst type = this.arena.get(typeId);
\t\tif (type.kind !== 'primitive') return undefined;
\t\treturn ['Bool', 'Int', 'Float', 'BigInt', 'String', 'Unit'].includes(type.name) ? type.name as NativeCallablePrimitiveKind : undefined;
\t}

\tprivate externalInlineCallableProjection(typeId: TypeId, expression: A.LambdaExpression): { readonly boundary: NativeCallableBoundaryDescriptor; readonly callable: import('../interop/types.js').NativeCallableTypeTemplate } | undefined {
\t\tconst type = this.arena.get(typeId);
\t\tif (!expression.async || type.kind !== 'function' || !type.async || type.typeParameters.length !== 0 || type.parameters.length === 0 || type.effects.some(effect => effect === '*' || !this.#effects.has(effect))) return undefined;
\t\tconst parameters: { readonly kind: 'foreign'; readonly type: import('../interop/types.js').ForeignTypeRef }[] = [];
\t\tfor (const parameter of type.parameters) {
\t\t\tconst foreign = this.currentExternalObjectRef(parameter);
\t\t\tif (foreign === undefined) return undefined;
\t\t\tparameters.push({ kind: 'foreign', type: foreign });
\t\t}
\t\tconst resultType = this.arena.get(type.result);
\t\tconst result = resultType.kind === 'primitive' && resultType.name === 'Never' ? 'Never' as const : this.currentExternalObjectRef(type.result);
\t\tif (result === undefined) return undefined;
\t\treturn Object.freeze({
\t\t\tcallable: Object.freeze({
\t\t\t\tparameters: Object.freeze(parameters),
\t\t\t\tresult: result === 'Never' ? result : { kind: 'foreign' as const, type: result },
\t\t\t\tasync: true,
\t\t\t}),
\t\t\tboundary: Object.freeze({
\t\t\t\tversion: 'virune-callable-shim/v2',
\t\t\t\tparameters: Object.freeze(parameters.map(() => 'External' as const)),
\t\t\t\tresult: result === 'Never' ? 'Never' : 'External',
\t\t\t\tasync: true,
\t\t\t\teffects: Object.freeze([...new Set(type.effects)].sort(compareText)),
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
checker.write_text(text[:a]+block+text[b:])

# preliminary evidence object-only
old="""\t\t\tconst parameters = this.validatedContextualCallableParameters(target.parameters, provider);
\t\t\tconst contextualResult = canonicalContextualCallableResult(target.result);
\t\t\tif (parameters === undefined || contextualResult?.kind !== 'deferred') return undefined;
\t\t\tresult.push(Object.freeze({ index: expectedIndex, target: Object.freeze({ parameters, result: contextualResult }) }));"""
new="""\t\t\tconst parameters = target.parameters.every(parameter => typeof parameter !== 'string' && parameter.category === 'object' && this.isCurrentForeignSnapshot(parameter, provider, false))
\t\t\t\t? Object.freeze(target.parameters as ForeignTypeSnapshot[])
\t\t\t\t: undefined;
\t\t\tconst contextualResult = canonicalContextualCallableResult(target.result);
\t\t\tif (parameters === undefined || contextualResult?.kind !== 'deferred') return undefined;
\t\t\tresult.push(Object.freeze({ index: expectedIndex, target: Object.freeze({ parameters, result: contextualResult }) }));"""
replace_once(Path('packages/compiler/src/checker/checker.ts'),old,new)

# final callable evidence validates per descriptor version, no general mixed helper
text=checker.read_text(); a=text.index('\tprivate validateCallableArgumentEvidence('); b=text.index('\n\tprivate contextualCallableTypeId(',a)
finalblock="""\tprivate validateCallableArgumentEvidence(
\t\traw: unknown,
\t\tinteropArguments: readonly InteropArgumentType[],
\t\tboundaries: readonly (NativeCallableBoundaryDescriptor | undefined)[],
\t\tprovider: JsInteropProvider,
\t): readonly InteropCallableArgumentResolution[] | undefined {
\t\tconst expectedIndexes = interopArguments.flatMap((argument, index) => argument.kind === 'native-callable' ? [index] : []);
\t\tif (expectedIndexes.length === 0) return raw === undefined || Array.isArray(raw) && raw.length === 0 ? [] : undefined;
\t\tif (!Array.isArray(raw) || raw.length !== expectedIndexes.length) return undefined;
\t\tconst result: InteropCallableArgumentResolution[] = [];
\t\tfor (let position = 0; position < raw.length; position++) {
\t\t\tconst item = raw[position];
\t\t\tif (!isRecord(item) || !hasExactEnumerableKeys(item, ['index', 'target'])) return undefined;
\t\t\tconst index = item.index;
\t\t\tconst expectedIndex = expectedIndexes.at(position);
\t\t\tif (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0 || expectedIndex === undefined || index !== expectedIndex) return undefined;
\t\t\tconst target = item.target;
\t\t\tconst boundary = boundaries.at(index);
\t\t\tif (!isRecord(target) || !hasExactEnumerableKeys(target, ['parameters', 'result']) || !Array.isArray(target.parameters) || boundary === undefined) return undefined;
\t\t\tconst contextualResult = canonicalContextualCallableResult(target.result);
\t\t\tif (contextualResult === undefined) return undefined;
\t\t\tlet parameters: readonly InteropCallableArgumentResolution['target']['parameters'][number][] | undefined;
\t\t\tif (boundary.version === 'virune-callable-shim/v1') {
\t\t\t\tconst primitives: ContextualCallablePrimitiveKind[] = [];
\t\t\t\tfor (const parameter of target.parameters) {
\t\t\t\t\tif (!isContextualCallablePrimitive(parameter)) return undefined;
\t\t\t\t\tprimitives.push(parameter);
\t\t\t\t}
\t\t\t\tparameters = Object.freeze(primitives);
\t\t\t} else {
\t\t\t\tif (!target.parameters.every(parameter => typeof parameter !== 'string' && parameter.category === 'object' && this.isCurrentForeignSnapshot(parameter, provider, false))) return undefined;
\t\t\t\tparameters = Object.freeze(target.parameters as ForeignTypeSnapshot[]);
\t\t\t}
\t\t\tif (!this.callableBoundaryMatchesContext(boundary, parameters, contextualResult)) return undefined;
\t\t\tresult.push(Object.freeze({ index, target: Object.freeze({ parameters, result: contextualResult }) }));
\t\t}
\t\treturn Object.freeze(result);
\t}
"""
checker.write_text(text[:a]+finalblock+text[b:])

# contextual type object-only
old="""\tprivate contextualCallableTypeId(value: InteropCallableArgumentResolution['target']['parameters'][number], provider: JsInteropProvider): TypeId | undefined {
\t\tif (typeof value !== 'string') return this.isCurrentForeignSnapshot(value, provider, false) ? this.arena.foreign(value) : undefined;
\t\treturn value === 'boolean' ? this.arena.bool
\t\t\t: value === 'string' ? this.arena.string
\t\t\t\t: value === 'number' ? this.arena.float
\t\t\t\t\t: value === 'bigint' ? this.arena.bigint
\t\t\t\t\t\t: value === 'undefined' ? this.arena.unit
\t\t\t\t\t\t\t: undefined;
\t}"""
new="""\tprivate contextualCallableTypeId(value: InteropCallableArgumentResolution['target']['parameters'][number], provider: JsInteropProvider): TypeId | undefined {
\t\treturn typeof value !== 'string' && value.category === 'object' && this.isCurrentForeignSnapshot(value, provider, false)
\t\t\t? this.arena.foreign(value)
\t\t\t: undefined;
\t}"""
replace_once(Path('packages/compiler/src/checker/checker.ts'),old,new)

# remove mixed extension from test (restore artifact base content)
test=root/'packages/js-interop/test/contextual-external-callable.test.ts'
t=test.read_text()
t=t.replace('\nexport declare function routeMixed(handler: (context: ExternalContext, count: number) => Promise<ExternalResponse>): void;','')
marker="\ntest('mixed primitive and External contextual parameters remain outside v2'"
if marker in t:
    t=t[:t.index(marker)].rstrip()+"\n"
test.write_text(t)

# Keep contextual-object callable validation on the existing primitive-only v1 path.
p = root / 'packages/compiler/src/checker/checker.ts'
text = p.read_text()
old = '''\t\t\tif (preparedEntry.boundary !== undefined) {\n\t\t\t\tif (!hasExactEnumerableKeys(entry, ['callable', 'index', 'property'])) return undefined;\n\t\t\t\tconst callable = entry.callable;\n\t\t\t\tif (!isRecord(callable) || !hasExactEnumerableKeys(callable, ['parameters', 'result']) || !Array.isArray(callable.parameters)) return undefined;\n\t\t\t\tconst parameters = this.validatedContextualCallableParameters(callable.parameters, provider);\n\t\t\t\tif (parameters === undefined) return undefined;\n\t\t\t\tconst contextualResult = canonicalContextualCallableResult(callable.result);\n\t\t\t\tif (contextualResult === undefined || !this.callableBoundaryMatchesContext(preparedEntry.boundary, parameters, contextualResult)) return undefined;\n\t\t\t\tentries.push({ index, property, callable: Object.freeze({ parameters: Object.freeze(parameters), result: contextualResult }) });\n\t\t\t\tnested.push(undefined);\n'''
new = '''\t\t\tif (preparedEntry.boundary !== undefined) {\n\t\t\t\tif (!hasExactEnumerableKeys(entry, ['callable', 'index', 'property'])) return undefined;\n\t\t\t\tconst callable = entry.callable;\n\t\t\t\tif (!isRecord(callable) || !hasExactEnumerableKeys(callable, ['parameters', 'result']) || !Array.isArray(callable.parameters)) return undefined;\n\t\t\t\tconst parameters: ContextualCallablePrimitiveKind[] = [];\n\t\t\t\tfor (const parameter of callable.parameters) {\n\t\t\t\t\tif (!isContextualCallablePrimitive(parameter)) return undefined;\n\t\t\t\t\tparameters.push(parameter);\n\t\t\t\t}\n\t\t\t\tconst contextualResult = canonicalContextualCallableResult(callable.result);\n\t\t\t\tif (contextualResult === undefined || preparedEntry.boundary.version !== 'virune-callable-shim/v1' || !this.callableBoundaryMatchesContext(preparedEntry.boundary, parameters, contextualResult)) return undefined;\n\t\t\t\tentries.push({ index, property, callable: Object.freeze({ parameters: Object.freeze(parameters), result: contextualResult }) });\n\t\t\t\tnested.push(undefined);\n'''
if text.count(old) != 1:
    raise RuntimeError(f'expected one contextual object callable block, found {text.count(old)}')
p.write_text(text.replace(old, new, 1))

print('simplified')
