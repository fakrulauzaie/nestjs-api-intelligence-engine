# Inter-Method Request-to-Column Provenance

Phase 21 conditionally extends the Phase 20 symbolic-origin analysis through already
proven direct method calls. It can show that a request field declared by a Nest
controller may influence a specific entity column written by a service, while keeping
ordinary call reachability separate from value provenance.

This is still influence, not exact data lineage. Runtime validation, pipes, mappers,
TypeORM transformers, subscribers, database defaults, triggers, and control flow may
change the value that is ultimately stored.

## Call-frame model

Analysis starts only from checker-proven `Body`, `Param`, and `Query` parameters on
supported endpoint handlers. For each checker-resolved direct injected-member call,
the analyzer maps argument position to callee parameter position and creates an
immutable symbolic call frame. A frame carries only origins actually found in its
arguments; endpoint reachability never creates an origin.

Whole request objects and selected one-field paths can cross a call. Supported direct,
alias, destructuring, string-normalization, binary, and template expressions retain
the Phase 20 `direct`, `derived`, or `unknown` state. A transformed argument remains
`derived` in the callee. Two origins used by one supported derived expression produce
two separate “may flow” records for the same target column.

Traversal follows only the existing `nest.call.injected-member.v1` relationship and
stops at the scan's configured `maxCallDepth`. Frames are memoized by method and
normalized origin shape. Independent limits cap frames, origins per frame, origins per
value, and expression depth.

## Canonical call-path evidence

An inter-method `ColumnInfluenceRecord` uses
`request.provenance.inter-method-object-write.v1` and retains an ordered `callPath`.
Every step names its caller method, callee method, and call-site evidence. Same-method
Phase 20 influence has an empty path. Cross-record validation requires a continuous
path from the request parameter's handler to the method owning the write sink and
requires every referenced method and evidence record to exist.

The canonical assertion still uses `REQUEST_FIELD_MAY_FLOW_TO_COLUMN`. Its evidence
contains the request declaration/decorator, propagation expressions, every call site,
the explicit sink property, the proven TypeORM operation/entity target, and the entity
column declaration. The rule does not claim all values reaching a method reach all of
its writes.

## Supported sinks and criteria boundary

The sink catalogue remains unchanged:

- proven repository `insert({ ... })`;
- the value object, never the criteria argument, of repository
  `update(criteria, { ... })`;
- `values({ ... })` on a proven executed QueryBuilder insert; and
- `set({ ... })` on a proven executed QueryBuilder update.

The entity and static property must resolve to a Phase 19 column. `save()`, `remove()`,
raw-SQL parameters, whole-object writes, spreads, computed keys, and unresolved
columns do not receive guessed field-to-column edges.

## Fail-closed boundaries

Inter-method propagation stops rather than choosing a target at:

- overload or target ambiguity;
- spread arguments or rest parameters;
- callback-bearing arguments;
- interface/polymorphic dispatch without one proven implementation;
- a missing analyzable in-repository method body;
- recursion or another call cycle; or
- the configured call-depth or resource limit.

`REQUEST_PROVENANCE_INTER_METHOD_UNSUPPORTED` identifies unsupported call-frame
construction. `REQUEST_PROVENANCE_CALL_DEPTH_LIMIT` identifies the configured depth
boundary. Existing `REQUEST_PROVENANCE_UNSUPPORTED` and
`REQUEST_PROVENANCE_LIMIT_EXCEEDED` remain responsible for sink/expression and global
resource boundaries. A same-named method that is not proven as the called target is
never analyzed through name matching.

## Report

The request-to-column section of `contracts.md` shows the sink method, root request
field, ordered call path, entity/database column, state, sink, assertion status, and
evidence. Endpoint filters select records by the root request handler, so a service
sink remains visible in the selected controller endpoint's report. Canonical-only
`report` reconstructs the same output without rescanning source.
