# Project Semantic Context

`project-semantic.virune` is the project-wide semantic adapter used after module linking and before deterministic emission.

The version-1 fixture contract validates:

- unique module paths and symbol names;
- existence of referenced modules and symbols;
- cross-module visibility;
- effect availability in the referencing module.

Diagnostics are deterministic in canonical module and reference order. The adapter is filesystem-free and accepts only normalized project data, so the Host remains responsible for path and I/O boundaries.
