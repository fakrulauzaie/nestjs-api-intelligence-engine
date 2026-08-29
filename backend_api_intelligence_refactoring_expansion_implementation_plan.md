# Backend API Intelligence Refactoring Expansion Implementation Plan

Status: active internal implementation plan  
Scope begins after Phase 37  
Primary validation target: `ticket-service-example` plus frozen synthetic fixtures

This plan is an internal execution guide for extending the engine without weakening
its evidence-backed, fail-closed semantics. It deliberately excludes git, branch, PR,
and source-control workflow expansion. Cross-service work consumes completed analysis
artifacts and never checks out or compares repository revisions.

## Cross-cutting rules

- A static match proves only a supported source relationship. It never proves runtime
  deployment, broker delivery, authorization success, lock acquisition, or cache hits.
- New exact facts retain declaration and resolution evidence. Unsupported or ambiguous
  cases remain explicit diagnostics or residual unknown branches.
- Repository containment remains unchanged. TypeScript aliases may resolve source
  inside the selected repository, but the analyzer does not traverse arbitrary source
  outside it or execute imported packages.
- Existing analysis, comparison, impact, policy, structured-export, and offline-graph
  consumers must be audited before a model contract changes.
- Real-service verification supplements frozen positive and negative fixtures; it does
  not replace deterministic tests.

## Milestone R1: Precise BullMQ identities and branches

### Phase 38 — Unified bounded constant resolution

Status: complete

Goal: replace the narrow one-hop string helper with one shared, checker-backed,
bounded resolver suitable for framework identities.

Deliverables:

1. Resolve string literals and no-substitution templates.
2. Resolve bounded acyclic chains of uniquely declared immutable `const` variables.
3. Resolve regular and `const enum` string members through TypeScript symbols.
4. Resolve property and string-element access on repository-visible `as const` object
   literals, including imported aliases.
5. Preserve all resolution-basis nodes in deterministic traversal order without
   duplicates.
6. Fail closed for mutable bindings, getters/methods, computed keys, spreads,
   destructuring, non-string values, ambiguous declarations, cycles, and depth-limit
   exhaustion.
7. Reuse the resolver through existing consumers, with direct BullMQ coverage for
   aliased enum job names.
8. Document that `tsconfig.paths` is already TypeScript-owned and that only
   repository-contained source is eligible.

Acceptance:

- The ticket-service shape `VerificationJob.CTT_PPOE_API_SYNC` resolves to its exact
  job string when its enum source is inside the scanned repository.
- Existing mutable/dynamic negatives remain unresolved.
- Focused tests, full tests, typecheck, build, lint, and formatting checks pass.

Non-goals:

- Evaluating JavaScript, package exports, environment values, functions, getters, or
  arbitrary expressions.
- Supporting TypeScript project references or source outside the repository root.
- BullMQ worker branch slicing; that begins in Phase 39.

Completion record:

- Added an eight-hop, cycle-safe shared resolver for immutable variable chains,
  checker-resolved string/`const enum` members, and nested property/string-element
  access on `as const` object literals.
- Retained fail-closed handling for mutable bindings, unasserted objects, spreads,
  computed keys, calls, cycles, ambiguous declarations, and depth exhaustion.
- Added direct BullMQ coverage using a repository-contained `~Share/*` path alias.
- A built-CLI scan of `ticket-service-example` resolved all five observed
  `verification-queue` producer job enums exactly. The queue-wide
  `VerificationProcessor.process` handler correctly remains dynamic and
  `proven_registered` pending Phases 39–40.
- Focused tests passed (2 files, 9 tests). The full parallel run passed 109 of 115
  files; the remaining six files failed only existing wall-clock thresholds under
  contention and all passed in a one-worker retry (6 files, 9 tests). Typecheck,
  build, lint, and formatting checks passed.

### Phase 39 — BullMQ branch contract and frozen corpus

Status: complete

Goal: define branch-scoped facts before filtering any worker effects.

Deliverables:

1. Introduce a branch/filter contract that distinguishes exact job branches,
   queue-wide common work, and a residual unknown branch.
2. Preserve call-site source ranges so branch traces do not reuse the full unsliced
   `process()` call graph.
3. Freeze fixtures for exact enum/literal cases, grouped empty labels, `break`,
   `return`, `throw`, default cases, common prelude/finally work, fallthrough,
   mutation, aliases, and unsupported predicates.
4. Audit schema evolution, semantic keys, comparison, impact, and report consumers.

Gate B0: no Phase 40 extractor work begins until the branch contract can represent
unsupported residual effects without dropping or job-overattributing them.

Completion record:

- Added a standalone, strict handler-dispatch contract with stable IDs for exact-job,
  all-job, unmatched-job, and unknown selectors; complete, partial, and unsupported
  states; and branch-scoped projections of existing canonical assertions.
- Froze three non-executable BullMQ source fixtures and a canonical expectation
  manifest covering direct switch/equality shapes, enum and `as const` labels,
  grouped labels, `break`, `return`, `throw`, default/unmatched paths, common prelude
  and `finally`, dynamic labels, non-empty fallthrough, aliases, mutation, and
  compound predicates.
- Gate B0 proves that partial and unsupported dispatches retain their discovered
  effects under explicit unknown residual branches. It forbids exact-job
  over-attribution, dropped residual effects, and broker-delivery conclusions.
- Froze analysis v3 and accepted ADR 0004: Phase 40 will publish branch facts through
  analysis v4 and independently migrate comparison, impact, policies, exports,
  Markdown, and graph consumers.
- Focused verification passed (2 files, 9 tests). The full run passed 307 of 308 tests;
  one existing endpoint-trace case exceeded its 20-second limit under parallel load,
  then the complete file passed in a one-worker retry (4 tests). Typecheck, build,
  lint with zero warnings, and formatting checks passed.

### Phase 40 — BullMQ branch extraction and propagation

Status: complete

Goal: link an exact producer job only to compatible branch-scoped worker effects.

Deliverables:

1. Support `switch (job.name)` for the exact `process()` parameter symbol.
2. Support safe grouped case labels and terminating braced bodies.
3. Add bounded `if`/`else if` equality chains only after switch coverage is stable.
4. Keep common and residual work queue-wide and diagnose partial slicing.
5. Propagate branch-specific calls, tables, comparison, impact, Markdown, controls,
   OpenAPI, and graph facts.
6. Retain `distributed_conditional` across every broker boundary.

Completion record:

- Published analysis v4 with strict handler-dispatch, branch, and branch-effect
  collections while retaining every v3 interaction and queue-wide handler fact.
- Added bounded extraction for direct `switch (job.name)` and top-level sequential
  strict-equality filters on the exact `WorkerHost.process()` parameter. Grouped empty
  labels, terminating branches, common prelude/finally work, and unmatched paths retain
  distinct selectors.
- Dynamic labels, non-empty fallthrough, aliases, mutation, and compound predicates
  preserve discovered effects under explicit partial or unsupported unknown residual
  branches with diagnostics; no effect is dropped or copied to every exact job.
- Endpoint traces select only compatible exact/common/unmatched branches. Queue-wide
  producer/handler matching remains a distributed candidate and never becomes proof of
  broker delivery or worker execution.
- Migrated comparison v3, impact v2, structured exports v4, Markdown, and graph v5.
  Selector-aware impact traversal rejects a branch only when every carried selector is
  proven incompatible and retains unknown residuals as potential impact.
- Focused branch verification passed (2 tests), the Phase 40 cross-consumer suite
  passed (15 files, 63 tests), and the final one-worker suite passed 120 files and 312
  tests. Typecheck, build, lint with zero warnings, and formatting checks passed.

## Milestone R2: Security and architecture refactoring views

### Phase 41 — Authorization metadata and composite decorators

Status: complete

Goal: inventory authorization requirements without misclassifying metadata as guard
enforcement.

Deliverables:

1. Model guard registration, authorization metadata, and enforcement relationships as
   separate facts.
2. Extract bounded `SetMetadata()` decorator wrappers and retain metadata keys while
   redacting or structurally representing values.
3. Resolve package-proven `applyDecorators(UseGuards(...))` compositions where the
   nested guard class is statically exact.
4. Allow exact-symbol or metadata-key configuration, never bare decorator names.
5. Use `proven_enforced`, `configured_relationship`, and `enforcement_unknown`
   semantics; configured assertions remain visibly configured.
6. Add policy/report views without allowing metadata alone to satisfy
   `require-guard-on-write-endpoint`.

Completion record:

- Published analysis v5 with separate authorization metadata and enforcement record
  families; analysis v1-v4 remain frozen and readable.
- Added package-proven direct `SetMetadata()`, bounded repository wrappers, exact
  configured package/repository decorators, and package-proven
  `applyDecorators(UseGuards(...))` composites. Every stored value is a redacted
  structural shape.
- Added exact project configuration v4 for metadata keys, decorator exports, and
  metadata-to-guard relationships. Bare names are rejected.
- Published `proven_enforced`, `configured_relationship`, and
  `enforcement_unknown` without claiming runtime authentication or authorization.
  Global configured relationships are scoped to a shared resolved application root
  (or the same declaring module), preventing cross-application guard attribution.
- Migrated comparison v4, impact v2, structured exports v5, graph v6, endpoint
  Markdown, and catalogues. Added `require-proven-authorization-enforcement`; the
  existing write-guard policy remains independent of metadata.
- Focused authorization verification passed (1 file, 3 tests), Documentation Gate D1
  passed (4 files, 8 tests), and the final one-worker suite passed 122 files and 316
  tests. Typecheck, build, lint with zero warnings, and formatting checks passed.

### Phase 42 — Architecture overview and bounded refactoring metrics

Status: pending

Goal: add a repository-level overview alongside endpoint and handler scenes.

Deliverables:

1. Compute direct call fan-in/fan-out and proven root reach counts.
2. Compute endpoint/handler reach counts for methods, tables, and interactions.
3. Render numeric metrics with percentile-based heat colouring and legends.
4. Cluster uniquely owned classes/methods by proven Nest module declarations.
5. Label ambiguous/multiple ownership explicitly.
6. Offer `not_reached_from_supported_roots`; never label records dead or safe to
   delete.

## Milestone R3: Cache and lock resource access

### Phase 43 — Resource-access substrate and cache extraction

Status: pending

Goal: represent non-relational resources without forcing them into communication
interaction semantics.

Deliverables:

1. Introduce `ResourceAccessRecord` with resource kind, operation, technology,
   structural target, source method, and evidence.
2. Support `cache-manager` `get`, `set`, `del`, and bounded `wrap` calls.
3. Support direct `ioredis` string/hash reads, writes, deletes, expiry, and bounded
   scans.
4. Preserve key structure (`exact`, `template`, `symbolic`, `dynamic`) without runtime
   values or payloads.
5. Propagate resource terminals through endpoint and handler traces, comparison,
   impact, reports, and graph scenes.

Pipelines, transactions, scripts, pub/sub, and arbitrary wrappers remain explicit
gaps until dedicated fixtures exist.

### Phase 44 — Redlock and bounded critical sections

Status: pending

Goal: identify known distributed-lock dependencies and bounded callback regions.

Deliverables:

1. Support package-proven Redlock acquisition APIs such as `using()`.
2. Resolve structural resource-key patterns and bounded critical-section callbacks.
3. Propagate calls and resource effects within supported callbacks.
4. Report lock dependency and scope only; never claim acquisition, exclusivity,
   contention, timing, or release success.

Gate L0: custom lock-wrapper adapters are deferred until Redlock fixtures demonstrate
that wrapper propagation can remain symbol-proven and fail closed.

## Milestone R4: Cross-service artifact stitching

### Phase 45 — System identity contract and stitching corpus

Status: pending

Goal: define safe cross-analysis identity and topology semantics before correlating
services.

Deliverables:

1. Define service namespaces so canonical IDs from different analyses never collide.
2. Define broker realms using technology, transport, queue/topic/pattern, optional
   prefix/namespace, and explicit environment/broker aliases.
3. Define correlation states for declared-realm candidates, target-only candidates,
   ambiguity, and unmatched records.
4. Freeze co-located, producer-only, consumer-only, multi-service, collision, and
   missing-topology fixtures for BullMQ and Nest microservices.
5. Define a separate `SystemAnalysisDocument`; never merge source analysis documents.

Gate S0: target-name equality alone must be unable to produce a proven cross-service
edge.

### Phase 46 — Artifact-only stitch engine and CLI

Status: pending

Goal: correlate completed analysis artifacts without scanning or source-control work.

Deliverables:

1. Accept named analysis files or `.api-intel` directories plus an optional topology
   manifest.
2. Validate compatible schema/tool capabilities and namespace all source records.
3. Correlate producers with in-repository delivery candidates using Gate S0 rules.
4. Preserve unmatched and ambiguous boundaries explicitly.
5. Emit canonical JSON and concise Markdown summaries with deterministic ordering.

### Phase 47 — System graph, policies, and hardening

Status: pending

Goal: expose stitched conditional paths without overstating distributed behavior.

Deliverables:

1. Render service and broker clusters with producer-to-candidate-handler paths.
2. Continue paths from HTTP roots to worker-side database/resource effects.
3. Add typed policies only for facts the system document can prove.
4. Add display limits, provenance, diagnostics, deterministic output, and schema
   compatibility tests.
5. Run full regression, built-CLI smoke verification through paths containing spaces,
   and manual offline-report verification.

## Explicitly not adopted

- Git, branch, PR, or source-control workflow expansion.
- Bare decorator-name configuration that turns metadata into a guard declaration.
- “Dead code” or “safe to delete” conclusions from missing static inbound paths.
- Runtime cache-hit, broker-delivery, or lock-contention claims.
- Blind cross-service matching by queue/topic/pattern text.
- Arbitrary package execution or source traversal beyond the selected repository.
