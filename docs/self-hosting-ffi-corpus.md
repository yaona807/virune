# Versioned self-host FFI corpus

The FFI boundary checker is now covered by a repository-owned corpus with a versioned manifest.

The corpus fixes representative safe-boundary, extern-policy, `@jsExport`, malformed-arena, and diagnostic-order expectations. Each case is evaluated twice to require byte-identical serialization, contiguous result IDs, bounded diagnostics, and valid diagnostic references.

This corpus does not change FFI semantics, execute JavaScript, resolve modules, or connect the self-host checker to the production compiler. It freezes the already implemented Host–Kernel contract so later semantic differential work can compare stable inputs and outputs.
