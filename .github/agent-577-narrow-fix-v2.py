from pathlib import Path

checker = Path('packages/compiler/src/checker/checker.ts')
text = checker.read_text()
anchor = "\tprivate currentExternalObjectRef(typeId: TypeId): import('../interop/types.js').ForeignTypeRef | undefined {\n"
helper = """\tprivate nativeCallablePrimitive(typeId: TypeId): NativeCallablePrimitiveKind | undefined {
\t\tconst type = this.arena.get(typeId);
\t\tif (type.kind !== 'primitive') return undefined;
\t\treturn ['Bool', 'Int', 'Float', 'BigInt', 'String', 'Unit'].includes(type.name) ? type.name as NativeCallablePrimitiveKind : undefined;
\t}

"""
if text.count(anchor) != 1:
    raise RuntimeError(f'expected one currentExternalObjectRef anchor, found {text.count(anchor)}')
if 'private nativeCallablePrimitive(' not in text:
    text = text.replace(anchor, helper + anchor, 1)
old = "result: result === 'Never' ? result : { kind: 'foreign', type: result },"
new = "result: result === 'Never' ? result : { kind: 'foreign' as const, type: result },"
if text.count(old) != 1:
    raise RuntimeError(f'expected one foreign result literal, found {text.count(old)}')
checker.write_text(text.replace(old, new, 1))

test_path = Path('packages/js-interop/test/contextual-external-callable.test.ts')
lines = test_path.read_text().splitlines(True)
fixed = []
for line in lines:
    depth = 0
    while line.startswith(r'\t'):
        depth += 1
        line = line[2:]
    fixed.append('\t' * depth + line)
test_path.write_text(''.join(fixed))
print('narrow-fix-v2-applied')
