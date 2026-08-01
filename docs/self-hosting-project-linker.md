# Project Linker

`project-linker.virune` converts the Virune-authored frontend AST for every canonical source into project dependency and export metadata.

The version-1 linker:

- extracts Virune and JavaScript imports from `ImportDeclaration`／`ImportSource` nodes;
- resolves relative Virune module paths without filesystem access;
- extracts public top-level declarations;
- validates duplicate modules and imports, self-imports, missing targets, cycles, and invalid relative specifiers;
- reports entry reachability and unreachable modules in canonical request order.

The linker is pure and consumes parser results supplied by the project compiler boundary. Filesystem discovery, canonical source ordering, and JavaScript interop policy remain Host responsibilities.
