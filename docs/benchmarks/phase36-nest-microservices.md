# Phase 36 Nest Microservice Benchmark

- Date: 2026-08-27
- Runtime: Node.js v22.13.1, pnpm 11.19.0, Windows x64
- Focused corpus: all seven frozen Nest microservice source fixtures plus a bounded
  hybrid-bootstrap case
- Persisted input: the activation fixture with one HTTP endpoint and five
  request-response interactions

## End-to-end fixture measurement

The eight-test Phase 36 suite creates isolated non-executable TypeScript projects,
writes pinned Nest/RxJS/TypeORM declaration stubs, scans every D0 topology, validates
the analysis, exercises endpoint and handler traces, comparison, impact, exports, and
graph projection, and cleans up. Its test bodies completed in 6,763 ms. The persisted
activation case completed in 1,313 ms.

These are test-wall-clock measurements and include setup and assertions, not scan
time alone.

| Artifact               |   Bytes | SHA-256                                                            |
| ---------------------- | ------: | ------------------------------------------------------------------ |
| `analysis.json`        |  34,886 | `6FB313E1AC24BF79916E63BE7F7EFFC7AD5D0CB64FE535A26E3638DA67AF1053` |
| `api-intel-graph.html` | 477,038 | `A240CCA18FADBA37F3996E083D798525EC1F3933904341DCE95CD019B06DD290` |

The persisted analysis is `completed_with_gaps`: it contains one endpoint, five
`microservice_message` interactions, no local handler, and five diagnostics. This is
the expected producer-only activation topology, not a missing-consumer failure.

## Built-CLI impact and graph measurement

The production build used the validated analysis as both sides of a self-comparison.
Each run wrote to a fresh output directory:

```text
node dist/cli/index.js impact <analysis.json> <analysis.json> --output <run-directory>
node dist/cli/index.js graph <analysis.json> --impact-results <run-directory>/impact.json --output <run-directory>
```

| Run | Impact (ms) | Graph (ms) | Impact bytes | Graph bytes |
| --: | ----------: | ---------: | -----------: | ----------: |
|   1 |      592.29 |     581.28 |        1,606 |     477,040 |
|   2 |      592.74 |     573.92 |        1,606 |     477,040 |
|   3 |      590.89 |     580.15 |        1,606 |     477,040 |

Median impact time was 592.29 ms and median graph time was 580.15 ms. Every impact
file had SHA-256
`CE6BE335CD8EC7D9D148777C86E95A499CC84F62922912297E6E3CB83817D86A`; every graph
file had SHA-256
`5BB550B3922B84BB19C12EE83229921D026C05CF4E7805C0EA083B1E2033B1B8`.

The measured graph is two bytes larger than the direct fixture artifact because it
contains the supplied no-change impact projection.

## Path-containing-spaces workflow smoke

The built CLI scanned `example-nestjs-app` into `.tmp/phase 36 cli smoke` in
3,161.21 ms. It published analysis schema `3.0.0`, seven endpoints, zero interactions,
and all four supported interaction kinds. The 127,114-byte canonical analysis had
SHA-256
`A0FF9F631F73B0C6BCD7DB17E0101C1473725CE22B210278E5DB446DAF9831B3`.

## Interpretation

These local workstation measurements are smoke baselines, not service-level
objectives. The durable signals are bounded completion across every D0 topology,
deterministic derived bytes across three publications, explicit artifact sizes, no
target execution, and no evidence of unbounded message-candidate fan-out or trace
growth.
