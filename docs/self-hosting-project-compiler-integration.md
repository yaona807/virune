# Project Compiler Integration

`project-compiler-contract.virune` composes the Virune-authored frontend, project linker, semantic context, lowering pipeline, and deterministic project emitter behind one versioned boundary.

The canonical self-host source set now proves the complete boundary:

1. all 31 canonical sources are parsed;
2. all 31 modules are checked;
3. no compiler diagnostic remains;
4. all 31 modules are emitted in canonical order;
5. repeated project compilation returns byte-identical structured results.

The capability therefore reports `ready: true` with an empty blocker list. This readiness claim is limited to Stage 1／Stage 2 bootstrap generation. It does not switch the production compiler, update the fixed Seed, relax compatibility gates, or authorize release promotion.

Parser, linker, semantic, lowering, and emission failures remain path-aware and fail closed. Accepted modules are emitted under `.selfhost-output/` with deterministic runtime imports and metadata.
