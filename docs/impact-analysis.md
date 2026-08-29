# Potential change-impact analysis

The `impact` command compares exactly two user-supplied, validated `analysis.json` documents and
reports endpoints that may be affected by changed static facts. Potential impact means
reachability in the supported assertion graph; it does not prove that runtime behavior
changed.

## Command

```powershell
pnpm run cli -- impact C:\reports\before\analysis.json C:\reports\after\analysis.json
pnpm run cli -- impact C:\reports\before\analysis.json C:\reports\after\analysis.json --format markdown --output C:\reports\impact
```

`--format` accepts `json` (the default) or `markdown`. The command writes `impact.json`
or `impact.md`; without `--output`, it writes beside the after analysis. It never
inspects a working tree, discovers changed paths elsewhere, or invokes a source-control
command or API.

## Inputs and source changes

Both inputs pass canonical schema and cross-record validation and must be in
`completed` or `completed_with_gaps` state. Source files match by normalized,
repository-relative path. A path present on only one side is added or removed; a path
on both sides is modified only when its recorded content hash differs. Byte length,
snapshot ID churn, and repository revision labels do not create source changes.

The analysis traverses both snapshots. The before graph preserves deleted paths; the
after graph preserves new paths. Traversal works backward from changed methods and
table subjects through method calls and endpoint-handler assertions, while emitted
paths retain the normal endpoint-to-subject direction. Each side uses its recorded
maximum call depth, cycle protection, and only resolved or ambiguous traversable
edges. Analysis v3 additionally traverses
`METHOD_INITIATES_INTERACTION` → `INTERACTION_MATCHES_LOCAL_HANDLER` →
`HANDLER_IMPLEMENTED_BY` for exact or configured-wildcard local events, bounded by the snapshot's
`maxInteractionHops`. These edges remain candidate/causal reachability, not proof of
runtime delivery.

Entity declaration changes first use the proven entity-to-table mapping, then find
endpoints that reach that table. A same-named but uncalled method is not connected by
name. Changed files with no supported endpoint path remain visible in a separate
unreachable section; an incomplete diagnostic can qualify that absence but never
invent a path.

## Impact document

`ImpactDocument` uses independent schema `1.0.0` for analysis v1-v3 inputs and
`2.0.0` when either input is analysis v4 or v5. Its reason categories are:

- `direct_endpoint_change` for added, removed, handler/guard/authorization-modified endpoints, or a
  changed handler source file;
- `reachable_method_file_change` for a changed method file reached through one or more
  supported calls;
- `entity_declaration_file_change` for a changed entity whose mapped table is reached;
- `table_access_fact_change` for added, removed, or status-changed method/table facts;
- `diagnostic_or_resolution_change` for endpoint-reachable diagnostic or assertion
  resolution changes, including explicit interaction/handler add, remove, and modify
  reasons; and
- `unknown_due_to_incomplete_trace` when a relevant evidence path is ambiguous or
  contains a subject with an incomplete-trace diagnostic.

A terminals-only endpoint diff is not labeled a direct edit. The table or transitive
reason remains separate, so direct endpoint changes and potential transitive impact are
not conflated.

Every endpoint reason records a changed semantic subject, reason code, before/after
evidence IDs, and one or more finite paths. Each path declares its snapshot side,
endpoint ID, ordered assertions, statuses, rule IDs, semantic endpoints, and evidence
IDs. The strict document validator checks source-change shapes, path continuity,
endpoint-side membership, duplicates, direct classification, and every summary count.

Interaction and handler changes are attached only when a supported before/after graph
contains a path from an endpoint. Local-event paths use the separate interaction-hop
budget and retain exact/wildcard match assertions; unreachable consumer-only handlers
are not invented as endpoint impact.

BullMQ interaction and handler changes use the same semantic mechanism. Endpoint
paths may cross `METHOD_INITIATES_INTERACTION` and
`INTERACTION_MATCHES_LOCAL_HANDLER`, while downstream worker effects retain their
distributed-conditional meaning. Producer-only boundaries and handler-only roots do
not become fabricated endpoint impact.

Impact v2 also consumes dispatch, branch, and branch-effect diff records. When a path
enters a BullMQ handler through a branch-scoped assertion, reverse traversal carries
that selector to the producer edge. An exact producer is excluded only when every
carried selector is proven incompatible; an unknown residual remains potential and is
qualified by its incomplete-trace diagnostic. This prevents a cleanup-only effect
from being attributed to a generate-only producer without claiming broker delivery.

Nest microservice producer/handler changes use the same distributed path model.
Transport-compatible event candidates may contribute conditional paths; ambiguous
request-response candidates remain visible facts but are not traversed. Producer-only
and consumer-only boundaries do not invent remote peers or broker delivery.

JSON publication recursively orders object keys and all set-like arrays. Markdown is
rendered only from a validated document and groups reasons under endpoint route slots.

## Interpretation boundary

Route slots, not runtime requests, are the grouping unit. Duplicate endpoints in a
route slot retain all before/after canonical IDs, while every path identifies the exact
endpoint record it reached. Ambiguous assertions remain visibly ambiguous. An analysis
with unrelated gaps does not make every impact uncertain; uncertainty is attached only
to relevant paths.

The command returns exit code `0` when a report is published, including when potential
impacts, unreachable files, or uncertainty exist. It reuses the established usage (`2`),
analysis-state (`6`), invalid-analysis (`7`), cancellation (`130`), and unexpected-error
(`1`) classes.
