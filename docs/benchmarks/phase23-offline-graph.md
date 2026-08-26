# Phase 23 Offline Graph Benchmark

- Date: 2026-08-24
- Runtime: Node.js v22.13.1, Windows x64
- Input: validated integrated `example-nestjs-app` analysis with seven endpoints
- Dependency: `cytoscape@3.34.0`, MIT

## Measurement

The production build generated the self-contained report five times from the same
already validated `analysis.json`. Each iteration includes Node startup, canonical
input loading/validation, graph projection, Cytoscape asset loading, CSP hashing, HTML
rendering, and atomic file publication.

```text
node dist/cli/index.js graph <analysis.json> --output <clean-run-directory>
```

| Run | Time (ms) | Output (bytes) |
| --: | --------: | -------------: |
|   1 |    976.11 |        537,284 |
|   2 |    939.14 |        537,284 |
|   3 |    913.70 |        537,284 |
|   4 |    912.05 |        537,284 |
|   5 |    909.99 |        537,284 |

Median generation time was 913.70 ms. All five output files were byte-identical in
size, and deterministic-content tests compare complete HTML bytes.

## Phase 12 comparison

The Phase 12 feasibility spike produced a 440,347-byte file containing a 435,328-byte
Cytoscape distribution and a four-node hard-coded graph. The production integrated
report is 537,284 bytes, a 22.01% size increase. That remains below the 25% review
threshold while adding seven validated endpoint scenes, evidence, filters, accessible
tables, safe serialized data, CSP hashes, responsive styling, and interaction code.

The pinned package occupies approximately 5,696,647 installed bytes in this pnpm
workspace; only its 435,328-byte minified browser distribution is embedded. Production
license inspection reports MIT. The dependency was selected and tested in Phase 12,
so no new UI-library ADR was required.

## Interpretation

This is a local workstation benchmark, not a cross-machine service-level objective.
The input snapshot and feature set differ from the original Phase 12 analyzer corpus,
so analyzer scan timings are not compared. Future report benchmarks should preserve
the command shape, input analysis, runtime, iteration count, and clean output boundary.
