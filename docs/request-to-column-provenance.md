# Intraprocedural Request-to-Column Provenance

Intraprocedural provenance gives a deliberately bounded answer to this question: within one supported
Nest handler, can a declared request field influence an explicit TypeORM write
property whose entity column is proven?

The answer is represented as influence, not exact data lineage. A record does not
claim that TypeORM stores byte-for-byte the value visible in source. Column
transformers, subscribers, database defaults, triggers, and runtime control flow may
change the eventual value.

## Canonical records

Analysis schema v2 includes:

- `RequestFieldOriginRecord`: owns a one-field path under a Phase 19
  `RequestParameterRecord`, retains every matching union DTO field, and labels origin
  resolution as `resolved`, `ambiguous`, or `unknown`.
- `ColumnInfluenceRecord`: connects that origin to a Phase 19 `EntityColumnRecord`,
  identifies the method, sink kind and static sink property, records
  `direct`/`derived`/`unknown`, and cites propagation, sink, and operation evidence.
- `REQUEST_PARAMETER_HAS_FIELD_ORIGIN` and
  `REQUEST_FIELD_MAY_FLOW_TO_COLUMN` assertions. “May flow” is intentional.

The records have stable IDs, deterministic ordering, strict schema validation,
cross-record integrity checks, and semantic keys for snapshot comparison.

## Supported origins and propagation

The method must already have a checker-proven `@nestjs/common` `Body`, `Param`, or
`Query` request declaration. Phase 20 supports:

- literal selectors such as `@Body('title') title: string`;
- a known top-level DTO field such as `dto.title`;
- one unique, non-mutated local alias;
- one object-destructuring binding;
- direct assignment and shorthand properties;
- the bounded string transforms `trim`, `toLowerCase`, `toUpperCase`, and `normalize`;
- binary and template expressions as derived influence.

A union DTO retains every matching field ID and marks the origin/assertion ambiguous;
it never selects one union member arbitrarily.

## Supported sinks

Column influence is considered only for inline object literals at:

- a proven injected repository `insert({ ... })`;
- the value argument of a proven injected repository
  `update(criteria, { ... })`;
- `values({ ... })` on a proven, executed QueryBuilder insert;
- `set({ ... })` on a proven, executed QueryBuilder update.

Update criteria is not a written-column sink. The static object property is resolved
against the entity property name, then linked to the recorded database name. Literal
`insert: false` or `update: false` metadata suppresses an incompatible influence.
A present transformer stays visible in the column record but does not erase the
influence.

## States and uncertainty

`direct` means the explicit sink property receives the field or one supported direct
alias. `derived` means a supported expression depends on the field. `unknown` means a
dependency remains visible after an unsupported mapper, mutation, nested callback,
loop, branch/exception boundary, or other bounded merge.

`REQUEST_PROVENANCE_UNSUPPORTED` explains unsupported relevant flow.
`REQUEST_PROVENANCE_LIMIT_EXCEEDED` reports the expression-depth or per-value origin
bound. Spreads and computed sink keys emit diagnostics but no guessed per-column
edge. A static property mixed with request-derived properties creates no origin for
the static value.

No column provenance is emitted for `save()` or `remove()`. Raw-SQL placeholder
mapping, nested object paths, arbitrary mapper interpretation, and branch-sensitive
execution are outside Phase 20. Existing endpoint reachability is not value-flow
proof.

## Report

`scan` and canonical-only `report` include a “Request-to-column influence” section in
`contracts.md`. It displays the method, request origin, call path, entity/database
column, influence state, sink, assertion status, and source evidence. View filters use
the root request handler, including when a later phase proves a service sink.

## Phase 21 extension

The frozen local corpus has no false `direct` edge: criteria-only/static/save/spread/
computed cases create no column claim, while arbitrary mappers and mutations remain
`unknown`. Phase 21 passed that go/no-go gate and now maps argument positions through
one checker-resolved direct callee within strict boundaries. The full call-frame,
evidence, depth, and stop contract is in
[Inter-Method Request-to-Column Provenance](inter-method-request-provenance.md).
