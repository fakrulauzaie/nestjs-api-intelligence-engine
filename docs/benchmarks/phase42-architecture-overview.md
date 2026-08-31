# Phase 42 Architecture Overview Verification

Phase 42 adds a repository-level architecture projection without changing the canonical
analysis v5 fact model. The projection is derived from validated assertions and the
existing bounded endpoint and interaction-handler traces.

## Verified semantic cases

| Case                                | Published result                                                 |
| ----------------------------------- | ---------------------------------------------------------------- |
| Resolved direct method calls        | Exact direct fan-in and fan-out counts                           |
| Endpoint and handler roots          | Separate and combined per-record reach counts                    |
| Ambiguous call edge                 | No downstream resolved reach attribution                         |
| Snapshot metric distribution        | Exact values plus deterministic nearest-rank p50/p75/p90 legends |
| One module declaration              | Unique compound module ownership                                 |
| Multiple module declarations        | Explicit `multiple_owners` without guessed containment           |
| Incomplete module metadata          | Explicit `ownership_unknown`                                     |
| Older analysis without module facts | Explicit `unavailable`                                           |
| Zero supported-root reach           | `not_reached_from_supported_roots`, never dead or safe to delete |

The architecture scene is bounded by the existing graph node and edge limits. Its
repository root and required compound parents remain present, omitted counts are exact,
and the complete metric and ownership arrays remain available outside the truncated
display scene.

## Publication outcome

- Analysis v5 remains frozen.
- Graph schema v7 adds one validated architecture overview alongside endpoint and
  handler scenes.
- The offline HTML report exposes all five metrics, exact numbers, percentile legends,
  ownership labels, and a semantic table equivalent.
- Validation recomputes the pure overview and rejects metric, ownership, scene-closure,
  evidence, limit, or summary corruption.

## Verification commands and outcome

- Focused architecture, graph, HTML, and documentation Vitest: 6 files and 14 tests
  passed.
- Full one-worker Vitest: 125 files and 323 tests passed.
- TypeScript typecheck: passed.
- Build: passed.
- ESLint with zero warnings: passed.
- Prettier check: passed.

The one-worker full run is the reproducible corpus measurement used here; it avoids
unrelated resource contention between TypeScript program fixtures.
