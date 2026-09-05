# Analysis comparison

The `diff` command compares two explicit, validated `analysis.json` snapshots. It does not scan
source, discover a baseline, or modify either input. A diff containing changes exits
successfully; changes are data, not a policy failure.

## Command

```powershell
pnpm run cli -- diff C:\reports\before\analysis.json C:\reports\after\analysis.json
pnpm run cli -- diff C:\reports\before\analysis.json C:\reports\after\analysis.json --format markdown --output C:\reports\comparison
```

`--format` accepts `json` (the default) or `markdown`. The output filename is
`diff.json` or `diff.md`. Without `--output`, the artifact is written beside the after
analysis. Both inputs must pass canonical schema and cross-record integrity validation
and must be in `completed` or `completed_with_gaps` state.

## Identity and matching

Canonical IDs remain audit references inside one snapshot. They are deliberately not
used for cross-snapshot matching. The comparison projection builds NFC-normalized,
canonical-JSON tuples for source files, classes, methods, endpoints, guards,
repository bindings, entities, tables, assertions, evidence, and diagnostics.

Endpoint matching is deterministic:

1. A duplicate route slot or semantic identity is reported as ambiguity and its
   endpoints remain unmatched.
2. Unique exact keys match by HTTP method, normalized path, and semantic handler.
3. Remaining route slots match only when each side has one endpoint. This classifies a
   handler replacement as modified.
4. Everything else remains added or removed. No fuzzy name or path matching occurs.

A source-file move changes class and method semantic identity. A unique endpoint route
may still be modified through route-slot matching, but unrelated same-named handlers
in different files do not collide.

## Diff document

`DiffDocument` uses independent schema `1.0.0` for v1/v2-only comparisons,
`2.0.0` when either input is analysis v3, `3.0.0` when either input is analysis v4,
`4.0.0` when either input is analysis v5, and `5.0.0` when either input is analysis
v6. The shared fields store:

- input analysis IDs, schema versions, result states, configurations, and fact availability;
- added, removed, and modified endpoints;
- handler, direct/effective guard, and reachable table-terminal facts;
- matched assertions whose resolution status changed;
- new, resolved, and changed diagnostics;
- semantic or route ambiguity with all candidate canonical IDs; and
- before/after assertion and evidence IDs needed to inspect the source analyses.

Schema `2.0.0` additionally publishes independent interaction and local-handler
changes. Identity uses semantic source/handler method, interaction kind, normalized
target, and application context. Target identity changes are add/remove; changes to
activation, boundary, dispatch timing, registration state, or extraction rule are
`modified` with explicit reasons. Canonical ID or evidence ordering churn alone does
not create a change, and duplicate semantic identities remain visible ambiguities.

The same projection applies to Phase 35 `job_queue` records. Queue or job identity
changes are add/remove changes; worker registration and rule changes are handler
modifications. Comparison does not interpret a local queue candidate as delivered.

Schema `3.0.0` additionally compares BullMQ dispatches, branches, and branch effects.
Their semantic keys are structural: handler plus dispatch rule; dispatch plus
canonical selector and control-flow kind; and branch plus effect kind, semantic
target, and source assertion. Selector/control-flow identity changes are add/remove;
state, status, or rule changes are explicit modifications. V1-v3 inputs expose branch
capability as unavailable rather than as an empty branch set.

Phase 36 `microservice_message` records use the same projection. Mode, canonical
pattern, client token, transport, and application context participate in semantic
identity. Activation/boundary/rule changes remain modifications. A local pattern
candidate is never interpreted as broker delivery.

Schema `5.0.0` additionally compares canonical non-relational resource-access facts
and each endpoint's reachable resource set. Identity uses technology, API, operation,
resource kind, structural target/selector, and source method. A reachable-set change
is the endpoint modification reason `resource_accesses`; payload values and runtime
keys never participate because they are not canonical facts.

The document contains no timestamp or absolute input path. Arrays and object keys are
canonically ordered before JSON publication. Markdown is rendered only after the
`DiffDocument` passes its own strict schema and integrity checks.

## Availability and interpretation

Analysis v1 proves direct guard declarations but does not model effective global
guards. The diff therefore records direct guards as `available` and effective guards
as `unavailable`. Analysis v2-v4 record effective guards as `available`, including
proven application-global registrations. It never treats unavailable as an empty
proven set.

Endpoint terminals are compared as direction plus semantic table identity. Canonical
method/assertion IDs and evidence remain attached for audit, but ID churn alone does
not create a terminal change. An ambiguous traversal or table assertion remains
`ambiguous` in the projected terminal.

Diagnostic identity uses code, semantic subject, and evidence location. Full evidence
keys retain content hashes for change detection, so independently scoped evidence IDs
can match while changed evidence content remains visible.

## Current compatibility boundary

The normalization boundary accepts analysis schemas `1.0.0` through `8.0.0`.
V1 module and effective-global-guard facts normalize to explicit unavailable/unknown
state; v2-v8 facts remain evidence-backed and available. Interaction families are
explicitly unavailable in v1/v2 and available, possibly empty, in v3-v8. Branch
families are unavailable in v1-v3 and available in v4-v8. Authorization families are
unavailable in v1-v4 and available, possibly empty, in v5-v8. Resource-access
families are unavailable in v1-v5 and available, possibly empty, in v6-v8. Critical-section
families are unavailable in v1-v6 and available in v7/v8. Authorization metadata,
redacted value shape, and enforcement-state changes are endpoint modification reasons.
Unknown
analysis or diff schema versions are rejected rather than interpreted best-effort.
Frozen schema `1.0.0` bytes remain unchanged for comparisons that contain no v3-v8
input.

## Exit behavior

The command reuses the established CLI result classes:

- `0`: a diff was published, including when changes or ambiguities exist;
- `2`: invalid arguments or format;
- `6`: an input analysis is failed or canceled;
- `7`: an input is unreadable, malformed, or fails canonical validation;
- `130`: cancellation before publication; and
- `1`: an unexpected comparison or publication failure.
