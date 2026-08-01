# Self-host Interop resolution witness

HostがSelf-host Kernelへ渡す各JavaScript specifierについて、versionedかつcandidate-boundなresolution witnessを生成・検証できるようにする。

`validateInteropResolutionWitness`は、contract version、platform、candidate commit、source manifest digest、完全なspecifier集合が期待値と一致しない限りfail closedとする。各module entryはspecifier順へ正規化し、次を固定する。

- resolution kindとresolved identity
- runtime format
- Node builtin以外のartifact SHA-256
- foreign type snapshotのSHA-256

builtinは`node:` identityと`artifactSha256=null`を要求する。relative pathはproject-relativeに限定する。URL resolutionはcredentialとfragmentを含まないHTTPS URLだけを許可する。duplicate、missing、unexpected、malformed、stale evidenceは決定的に拒否する。

このcontract自体はmodule解決、TypeScript AST参照、foreign code実行、Interop ABI v1変更を行わない。Hostが生成した証拠を検証してからInterop Manifest dataをKernelへ渡すための境界である。
