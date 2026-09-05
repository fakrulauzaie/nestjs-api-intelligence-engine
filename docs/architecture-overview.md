# Architecture Overview and Bounded Refactoring Metrics

Graph schema v7 introduced one repository-level architecture view beside the existing
endpoint and interaction-handler scenes for analysis v5. Current analysis v8 emits
graph v9, which retains that view and extends eligible reach records with canonical
non-relational resource accesses and Redlock critical-section scopes. The derived view
does not add canonical facts.

## Metric definitions

The architecture projection publishes numeric records for every canonical method,
table, and interaction:

| Metric                       | Eligible records                                 | Meaning                                                                                             |
| ---------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `direct_call_fan_in`         | methods                                          | Distinct resolved canonical `METHOD_CALLS_METHOD` edges targeting the method                        |
| `direct_call_fan_out`        | methods                                          | Distinct resolved canonical call edges leaving the method                                           |
| `endpoint_reach_count`       | methods, tables, interactions, resource accesses | Supported endpoint-rooted traces that reach the record through an entirely resolved path            |
| `handler_reach_count`        | methods, tables, interactions, resource accesses | Supported interaction-handler-rooted traces that reach the record through an entirely resolved path |
| `supported_root_reach_count` | methods, tables, interactions, resource accesses | Endpoint and handler reach counts added together                                                    |

The reach metrics reuse the configured call, interaction-hop, fan-out, branch, and
trace-state bounds. A distributed BullMQ or microservice branch remains a static local
delivery candidate and retains its conditional semantics. Reach never means that a
request, broker delivery, handler, method, or database operation ran at runtime.

An ambiguous edge is not allowed to make downstream records reached merely because a
later edge is resolved. The projection builds a resolved-only graph from each bounded
trace and counts a record only when it is connected to that trace's root.

## Zero reach

Zero supported-root reach is published only as
`not_reached_from_supported_roots`. It can describe framework lifecycle methods,
scheduled work, tests, scripts, reflection, dynamic dispatch, unsupported framework
patterns, code beyond configured limits, or genuinely unused code. The engine never
labels it dead code, unreachable in all executions, or safe to delete.

Analysis v1/v2 have no interaction-handler root family, so handler-root capability is
explicitly `unavailable` rather than a proven empty set. Current analysis v8 exposes
both endpoint and handler root counts.

## Percentile heat

Each metric has a deterministic nearest-rank legend with p50, p75, p90, maximum, and
eligible-record count. Values are classified as:

- `zero`: exactly zero;
- `low`: positive and at or below p50;
- `medium`: above p50 and at or below p75;
- `high`: above p75 and at or below p90; or
- `very_high`: above p90.

The offline report defaults to `supported_root_reach_count`. Developers can select any
metric from the Architecture heat control. Color is supplementary: the selected value,
band, reachability state, and ownership state are also present in the accessible graph
table, while exact thresholds appear in the facts panel.

Percentiles describe only the current repository snapshot and eligible record family.
They are visualization thresholds, not quality limits or policy violations.

## Module ownership and clustering

Only resolved `MODULE_DECLARES_CONTROLLER` and `MODULE_PROVIDES_CLASS` assertions
establish ownership. Classes and their methods use one of these states:

- `uniquely_owned`: exactly one supported module declaration; the class/method cluster
  is nested beneath that module;
- `multiple_owners`: two or more resolved module declarations, rendered explicitly
  without choosing a preferred owner;
- `not_declared_by_supported_modules`: no declaration and every discovered module has
  complete supported metadata;
- `ownership_unknown`: ambiguous evidence or incomplete module metadata could hide a
  declaration; or
- `unavailable`: the input analysis schema has no module facts.

Exports do not establish ownership. A class exported by a module but declared by
another module remains owned by its declaration module. Methods inherit their
declaring class's ownership state.

## Display and validation boundaries

The complete numeric and ownership arrays remain in `GraphReportDocument.architecture`
even when the visible architecture scene exceeds display limits. The scene uses the
same configurable node, edge, and evidence bounds as endpoint/handler scenes, retains
parent cluster closure, prioritizes supported roots and higher heat bands, and reports
all omissions explicitly.

Graph integrity validation recomputes the architecture metrics and ownership from the
canonical analysis, verifies scene record/evidence references, validates cluster
parents, and rejects summary or legend corruption. The HTML performs presentation
only; it does not recompute metrics client-side.
