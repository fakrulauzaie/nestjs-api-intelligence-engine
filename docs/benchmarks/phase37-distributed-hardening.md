# Phase 37 Distributed Hardening Benchmark

- Date: 2026-08-27
- Runtime: Node.js v22.13.1, pnpm 11.19.0, Windows x64
- Focus: interaction policies, graph schema v4, handler-rooted local-event/BullMQ/
  Nest microservice scenes, and self-contained HTML rendering

## Focused verification measurement

The focused six-file suite exercised policy outcomes, graph model/integrity/HTML,
configured local events, all frozen BullMQ topologies, and all frozen Nest
microservice topologies. Its 27 tests completed in 10.06 seconds wall clock; summed
test-body time was 16.40 seconds because Vitest ran files concurrently.

This includes creation and cleanup of isolated non-executable TypeScript projects,
static scans, comparison/impact/export checks retained from Phases 35-36, graph-v4
projection, and HTML generation. It is not scanner-only timing.

## Interpretation

The durable benchmark is bounded completion across endpoint and handler scenes:
every scene applies the declared node/edge/evidence limits, consumer-only repositories
need no synthetic endpoint, distributed table effects remain conditional, and the
renderer remains offline. These workstation measurements are smoke baselines, not
service-level objectives.

## Built-CLI path and determinism smoke

The production build scanned `example-nestjs-app` into `.tmp/phase 37 cli smoke`,
evaluated all three new rules, and rendered graph v4 with the policy overlay. The
fixture intentionally has no interactions, so each interaction rule was
`not_applicable`; this verifies the empty-subject contract rather than an interaction
finding.

| Artifact              |   Bytes | SHA-256                                                            |
| --------------------- | ------: | ------------------------------------------------------------------ |
| `analysis.json`       | 127,076 | `795F1F0757E525CA9876DE1EA0207A4D9EF002ABED7C127A403EBA69BB2CB4D9` |
| `policy-results.json` |   2,792 | `B8C1A817860D31D68C66A36E880F8A75F9B3EE2BFAE781768F654E09128F578F` |
| graph v4 HTML         | 541,339 | `D9347796A11CF1D0294371B583F268BEB063C32553BACD949F311E424291BB7D` |

Two independent graph publications had identical byte count and SHA-256. The HTML
metadata reports graph schema `4.0.0`. The scan found seven endpoints and seven
pre-existing fixture diagnostics and completed with gaps; no target application code
was imported or executed.
