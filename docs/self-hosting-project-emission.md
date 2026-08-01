# Project Emitter

`project-emitter.virune` is the deterministic assembly boundary between validated project semantics and Stage 1 artifacts.

The version-1 request carries canonical module order, normalized one-line preamble and statement entries, source-map text, dependency metadata, and exported-symbol metadata. The emitter adds a stable generated header and LF terminators, preserves metadata, and fails closed for duplicate paths, multiline entries, missing entries, or CR-containing source maps.

The module is pure and filesystem-free. Output-path selection and lower-level JavaScript statement construction remain explicit inputs until the project compiler integration slice connects the canonical lowering pipeline.
