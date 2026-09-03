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

## 2026-09-02 readability maintenance

A real ticket-service endpoint scene with 22 nodes and 26 edges exposed a presentation
defect: the breadth-first renderer used `spacingFactor: 1.15` while excluding labels
from node dimensions. Eleven callees could therefore occupy one tightly packed row as
if their nodes were only 30 px wide, even though wrapped labels were up to 130 px.

The first presentation-only correction used label-aware spacing, left-to-right causal
flow, bounded adaptive canvas height, and a hard readable zoom floor. User verification
showed that the floor kept labels clear but moved most high-fan-out scenes offscreen.

The 2026-09-03 revision replaces that trade-off with deterministic measured-rank
packing. Same-class helper labels are shortened only on the canvas, overloaded depth
layers fold into bounded rank bands, and connectivity-aware ordering reduces avoidable
crossings. The initial view always fits the complete scene and caps enlargement at
100%; selecting a node or edge fits its causal path up to 125%. Resolved routine edge
labels continue to use hover/focused-path disclosure, while uncertainty and impact
labels stay visible. Architecture remains top-down. The graph schema, full labels,
accessible table, and canonical scene contents are unchanged.
