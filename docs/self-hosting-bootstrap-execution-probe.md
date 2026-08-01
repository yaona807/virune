# Self-host bootstrap execution probe

The bootstrap execution probe turns the current Stage 0 project build into an executable compiler candidate and runs one Kernel Contract v1 compilation through it.

## What it proves

- the Stage 0 build succeeds without writing repository outputs;
- the normalized compiler artifact can be materialized and imported as ES modules;
- the entry module exports `compileMvp`;
- accepted and rejected compiler outputs remain deterministic;
- the evidence is bound to the compiler artifact, canonical input, and canonical output by SHA-256.

The evidence claim is always `stage0-compiler-execution-probe` and `productionEligible` is always `false`.

## What it does not prove

The probe does not claim that the candidate rebuilt the multi-module Self-host Kernel source, generated Stage 1 or Stage 2, passed the full differential suite, or is eligible for production promotion.

## Next bootstrap step

The next stage must replace the single-source probe input with a versioned project-compilation boundary that lets the executable candidate compile the canonical Self-host source manifest. Only that output may be labeled Stage 1.
