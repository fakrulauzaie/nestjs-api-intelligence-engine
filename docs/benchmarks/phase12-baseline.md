# Phase 12 analyzer baseline

- Date: 2026-08-17
- Tool version: 0.1.0
- Node.js: v22.13.1
- Platform: Windows x64
- CPU: 13th Gen Intel Core i5-13400F, 16 logical CPUs

## Purpose and boundary

This is an end-to-end CLI baseline before post-MVP production features are added. It
includes Node startup, TypeScript program construction, analysis, validation, and
artifact publication. Measurements and generated files are benchmark metadata only;
they are outside canonical analysis and do not participate in analysis identity.

## Reproduction

Build the current analyzer, then run the isolated harness:

```text
pnpm run build
cd spikes/phase12
pnpm run analyzer
```

For each corpus, the harness invokes this command five times with a clean output
directory:

```text
node dist/cli/index.js scan <corpus> --output spikes/phase12/.output/analyzer-benchmark/<corpus>/run-<n>
```

Corpus fingerprints are SHA-256 over sorted repository-relative paths and bytes for
`.ts` and `.json` files, excluding `.api-intel`, `.git`, `dist`, and `node_modules`.
They identify the measured local content without relying on source-control metadata.

## Summary

| Corpus                                      | Fingerprint                                                                   | Runs (ms)                                   |     Min |  Median |     Max |    Mean | Final output |
| ------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------- | ------: | ------: | ------: | ------: | -----------: |
| Integrated `example-nestjs-app`             | `74b809c949e23ae13a0f40f6cc7f2aba9cb453b8cae7a22bb1065c6b44e2a0fb` (30 files) | 4759.59, 2887.26, 2849.29, 2869.73, 2849.57 | 2849.29 | 2869.73 | 4759.59 | 3243.09 | 88,832 bytes |
| Local official Nest `sample/05-sql-typeorm` | `75484f579187dc3c0a7e1b9bbd8be3f386c9eb0868e26a196b65920249cb63cf` (15 files) | 2840.29, 2559.92, 2591.79, 2597.20, 2558.30 | 2558.30 | 2591.79 | 2840.29 | 2629.50 | 39,844 bytes |

The first integrated-fixture run is a visible cold-start outlier, so future comparisons
must retain individual runs and median rather than reporting only mean.

## Output details

| Corpus               | `analysis.json` | Endpoints | Assertions | Evidence | Diagnostics |
| -------------------- | --------------: | --------: | ---------: | -------: | ----------: |
| Integrated fixture   |    73,737 bytes |         7 |         35 |       90 |           6 |
| Official Nest sample |    31,968 bytes |         4 |         16 |       35 |           2 |

The integrated fixture's final output contains 16 source files, 11 classes, 17
methods, and seven endpoint trace files. The official sample contains 13 source files,
three classes, eight methods, and four endpoint trace files.

## Comparison policy

Future phase reports must use the same machine/runtime, exact corpus fingerprint,
command shape, iteration count, and output boundary before comparing these numbers.
Material differences in any of those inputs require a new baseline rather than a
regression claim. Performance budgets are intentionally not frozen from a single
workstation run.
