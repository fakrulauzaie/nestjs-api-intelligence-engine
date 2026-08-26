# Phase 35 BullMQ Benchmark

- Date: 2026-08-26
- Runtime: Node.js v22.13.1, pnpm 11.19.0, Windows x64
- Input: the frozen co-located BullMQ fixture with one endpoint, one queue producer,
  one registered queue-wide worker, and one conditional TypeORM write
- Result: analysis schema `3.0.0` with one `job_queue` interaction and one handler

## End-to-end fixture measurement

The focused Phase 35 test creates an isolated non-executable TypeScript project,
writes pinned declaration stubs, scans source, validates the analysis, traces the
endpoint and handler, builds comparison/impact and structured exports, projects the
graph, renders offline HTML, writes artifacts, and cleans up. The co-located case
completed in 1,908 ms. All five BullMQ semantic cases completed in 8,776 ms.

These are test-wall-clock measurements and include setup and assertions, not scan
time alone.

| Artifact               |   Bytes | SHA-256                                                            |
| ---------------------- | ------: | ------------------------------------------------------------------ |
| `analysis.json`        |  30,412 | `9EFE96E2F241BCF40DC92EFAE8A9ED40CFC23366378A79CCACA8D44D3FB760B0` |
| `api-intel-graph.html` | 482,027 | `FEC104A2CEBC726D81C28F309AA71D955B618299F63DE1DD62AE6AFCB691E4FB` |

## Built-CLI impact and graph measurement

The production build used the same validated analysis as both sides of a
self-comparison. Each run wrote to a fresh output directory:

```text
node dist/cli/index.js impact <analysis.json> <analysis.json> --output <run-directory>
node dist/cli/index.js graph <analysis.json> --impact-results <run-directory>/impact.json --output <run-directory>
```

| Run | Impact (ms) | Graph (ms) | Impact bytes | Graph bytes |
| --: | ----------: | ---------: | -----------: | ----------: |
|   1 |      819.62 |     814.75 |        1,606 |     482,029 |
|   2 |      828.19 |     785.02 |        1,606 |     482,029 |
|   3 |      802.70 |     838.93 |        1,606 |     482,029 |

Median impact time was 819.62 ms and median graph time was 814.75 ms. Every impact
file had SHA-256
`CE6BE335CD8EC7D9D148777C86E95A499CC84F62922912297E6E3CB83817D86A`; every graph
file had SHA-256
`97A49239B743B54A36658CB9037E6118406A506EA43F1B9C55ECC99D0B9D29FC`.

The measured graph is two bytes larger than the direct fixture artifact because it
contains the supplied no-change impact projection.

## Interpretation

These local workstation measurements are smoke baselines, not service-level
objectives. The durable signals are bounded completion, deterministic bytes across
three independent publications, explicit artifact sizes, and no evidence of
unbounded queue fan-out or trace growth. Future queue or microservice work should
compare against this command shape and preserve the distributed-conditional boundary.
