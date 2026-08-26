# Phase 34 Local Interaction Benchmark

- Date: 2026-08-26
- Runtime: Node.js v22.13.1, pnpm 11.19.0, Windows x64
- Integrated input: the Phase 34 integration project composed from
  `outbound-http.ts.txt` and `nest-event-emitter-wildcard.ts.txt`
- Integrated result: analysis schema `3.0.0`, `completed_with_gaps`, nine endpoints,
  twenty interactions, and nine interaction handlers

## Integrated fixture generation

The focused integration test creates a temporary non-executable TypeScript project,
writes pinned framework declarations, scans it, validates the v3 graph projection,
and renders the self-contained HTML report. The observed focused run completed in
1,021 ms. This is an end-to-end fixture measurement, so it includes setup, scan,
projection, rendering, assertions, and cleanup rather than scan time alone.

The persisted manual-verification artifacts were:

| Artifact               |   Bytes |
| ---------------------- | ------: |
| `analysis.json`        | 165,252 |
| `api-intel-graph.html` | 614,780 |

## Built-CLI impact and graph measurement

The same validated integrated analysis was used as both sides of a self-comparison.
Each run used a new output directory and the production build:

```text
node dist/cli/index.js impact <analysis.json> <analysis.json> --output <run-directory>
node dist/cli/index.js graph <analysis.json> --impact-results <run-directory>/impact.json --output <run-directory>
```

| Run | Impact (ms) | Graph (ms) | Impact bytes | Graph bytes |
| --: | ----------: | ---------: | -----------: | ----------: |
|   1 |      610.71 |     619.14 |        1,606 |     614,782 |
|   2 |      612.59 |     615.88 |        1,606 |     614,782 |
|   3 |      610.70 |     593.39 |        1,606 |     614,782 |

Median impact time was 610.71 ms and median graph time was 615.88 ms. All three
impact files had SHA-256
`CE6BE335CD8EC7D9D148777C86E95A499CC84F62922912297E6E3CB83817D86A`; all three
HTML files had SHA-256
`8944F39857AE76DB25A0D529B5315E52E4358DEBBB55F39708759CC0F744F314`.

The two-byte difference from the manual HTML artifact is expected: these measured
reports include the supplied no-change impact projection, while the manual artifact
does not.

## Path-containing-spaces workflow smoke

The production CLI was also exercised through the complete scan/report/impact/graph
workflow under `.tmp/phase 34 cli final`. Two scans of `example-nestjs-app` completed
in 2,750.60 ms and 2,724.78 ms and produced byte-identical 126,978-byte analyses with
SHA-256 `6EB2016B5364BA773977E551C8DCD740BE7FDFE85E4C9A84513112F9F45590F2`.
Report, impact, and graph commands completed in 620.98 ms, 628.07 ms, and 599.74 ms;
the graph was 535,454 bytes.

## Interpretation

These are local workstation smoke measurements, not service-level objectives. The
durable acceptance signals are bounded completion, deterministic bytes, explicit
artifact sizes, and the absence of a material regression signal. Future interaction
expansions should preserve this fixture composition and command shape when comparing
impact traversal or graph growth.
