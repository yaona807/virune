from pathlib import Path

p = Path('packages/compiler/src/checker/checker.ts')
text = p.read_text()
old = "private nativeCallableBoundary(typeId: TypeId, expression: A.Expression): NativeCallableBoundaryDescriptor | undefined {"
new = "private nativeCallableBoundary(typeId: TypeId, expression: A.Expression): Extract<NativeCallableBoundaryDescriptor, { readonly version: 'virune-callable-shim/v1' }> | undefined {"
if text.count(old) != 1:
    raise RuntimeError(f'expected one v1 nativeCallableBoundary signature, found {text.count(old)}')
p.write_text(text.replace(old, new, 1))
print('simple-fix')
