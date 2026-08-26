# Phase 25 Graph Baseline Benchmark

- Date: 2026-08-24
- Runtime: Node.js v22.13.1, Windows x64
- Input: `test/golden/example-nestjs-app/analysis.json` (73,737 bytes; SHA-256
  `82B719EB1F8B938C6C2443183F3955A14167AB092823CC8CA092A1FF0D2812CD`)
- Scenario: the same validated seven-endpoint snapshot is used as before and after so
  timing measures orchestration and impact projection without source-change variance

## Measurement

Each run uses new output directories. Baseline mode is measured as one compiled CLI
invocation:

```text
node dist/cli/index.js graph <analysis.json> --baseline <analysis.json> --output <baseline-directory>
```

The comparison path measures the former two-command interaction:

```text
node dist/cli/index.js impact <analysis.json> <analysis.json> --output <two-step-directory>
node dist/cli/index.js graph <analysis.json> --impact-results <two-step-directory>/impact.json --output <two-step-directory>
```

| Run | Baseline (ms) | Two-step (ms) | Graph bytes | Byte-identical |
| --: | ------------: | ------------: | ----------: | :------------- |
|   1 |        733.55 |       1257.61 |     528,478 | yes            |
|   2 |        604.36 |       1149.42 |     528,478 | yes            |
|   3 |        634.42 |       1252.65 |     528,478 | yes            |
|   4 |        671.91 |       1273.21 |     528,478 | yes            |
|   5 |        641.20 |       1227.71 |     528,478 | yes            |

Median baseline generation was 641.20 ms versus 1252.65 ms for the two-command path,
a 48.81% local wall-time reduction. All corresponding HTML files were byte-identical,
and baseline mode created no `impact.json`.

## Interpretation

This is a local workflow benchmark, not a service-level objective. A self-comparison
isolates command startup, input validation, semantic projection, impact calculation,
Cytoscape loading, CSP hashing, rendering, and publication. Changed-snapshot correctness
and before/after direction are covered separately by the Phase 25 CLI fixtures. The
main durable result is equivalence: eliminating intermediate serialization changes
neither graph bytes nor impact semantics.
