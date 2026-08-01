# Project Compiler Integration

`project-compiler-contract.virune` now composes the four isolated self-hosting lanes into one versioned project boundary:

1. parse every canonical source with the Virune frontend parser;
2. build and validate the project module graph;
3. construct the project semantic context;
4. lower modules through the established Pure Core MVP pipeline;
5. assemble deterministic ES2022 modules through the project emitter.

Accepted MVP modules receive a deterministic runtime import and are emitted under `.selfhost-output/` in canonical source order. Parser, linker, semantic, and lowering diagnostics remain fail-closed and path-aware.

The capability deliberately remains `ready: false` with the blocker `full-language-lowering-not-implemented`. The integration proves the data flow and executable multi-module artifact contract without claiming that records, enums, generics, effects, async, or other full-language constructs can already self-compile. The next slice replaces the MVP lowering step with the complete frontend HIR and emitter.
