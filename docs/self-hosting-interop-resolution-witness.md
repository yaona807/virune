# Self-host Interop resolution witness

The Host can now produce a versioned, candidate-bound resolution witness for every JavaScript specifier passed to the self-host kernel.

`validateInteropResolutionWitness` fails closed unless the witness matches the expected contract version, platform, candidate commit, source-manifest digest, and complete specifier set. Module entries are normalized by specifier and bind:

- resolution kind and resolved identity;
- runtime format;
- artifact SHA-256, except for Node built-ins;
- foreign type-snapshot SHA-256.

Built-ins require `node:` identities and no artifact digest. Relative paths remain project-relative. URL resolutions require credential-free HTTPS URLs without fragments. Duplicate, missing, unexpected, malformed, or stale evidence is rejected deterministically.

This contract does not resolve modules itself, inspect TypeScript AST nodes, execute foreign code, or change Interop ABI v1. It verifies Host-produced evidence before the kernel consumes Interop Manifest data.
